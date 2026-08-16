import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "@playwright/test";
import {
  startProductionServer,
  stopProductionServer,
} from "./helpers/production-server.mjs";

const root = path.resolve(import.meta.dirname, "..");
const referenceTrip = JSON.parse(
  await readFile(path.join(root, "data", "northstar-isles-trip.json"), "utf8"),
);
const firstTravelerId = referenceTrip.travelers[0].id;
const excludedShareValues = [
  ...referenceTrip.flights.map((record) => record.confirmation),
  ...referenceTrip.lodging.flatMap((record) => [
    record.confirmation,
    record.host_phone,
    record.wifi?.network,
  ]),
  ...referenceTrip.cruise.staterooms.map((record) => record.reservation),
  ...referenceTrip.ground_transport.flatMap((record) => [
    record.pnr,
    ...Object.values(record.boarding_codes || {}),
  ]),
].filter(Boolean);

async function openTab(page, name, heading) {
  await page.getByRole("button", { name, exact: true }).first().click();
  await page.getByRole("heading", { name: heading, exact: true }).waitFor();
}

test("production hydrates, navigates, persists state, and works offline with isolated storage", { timeout: 90_000 }, async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "travel-reference-browser-"));
  const port = 26200 + Math.floor(Math.random() * 400);
  let running;
  let browser;
  try {
    running = await startProductionServer({ dataDir, port, appPort: port + 1 });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: "allow" });
    const page = await context.newPage();
    const consoleErrors = [];
    const failedAssets = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("response", (response) => {
      if (/\/assets\/.*\.js(?:\?|$)/.test(response.url()) && !response.ok()) {
        failedAssets.push(`${response.status()} ${response.url()}`);
      }
    });

    const response = await page.goto(running.origin, { waitUntil: "networkidle" });
    assert.equal(response?.status(), 200);
    await page.getByRole("heading", { name: /Your whole trip/i }).waitFor();
    await openTab(page, "Packing", "Team packing");
    assert.deepEqual(failedAssets, []);
    assert.deepEqual(consoleErrors, []);

    const firstCheck = page
      .locator(`[data-check-id^="reference-packing:${firstTravelerId}:"]`)
      .first();
    const firstId = await firstCheck.getAttribute("data-check-id");
    assert.ok(firstId);
    const saved = page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith("/api/checklist") &&
        candidate.request().method() === "PUT",
    );
    await firstCheck.click();
    assert.equal(await firstCheck.getAttribute("aria-pressed"), "true");
    assert.equal((await saved).status(), 200);

    await page.reload({ waitUntil: "networkidle" });
    await openTab(page, "Packing", "Team packing");
    assert.equal(
      await page.locator(`[data-check-id="${firstId}"]`).getAttribute("aria-pressed"),
      "true",
    );

    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(
      await page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
      true,
    );

    const initialStorage = await page.evaluate(async () => ({
      local: Object.keys(localStorage).sort(),
      session: Object.keys(sessionStorage).sort(),
      indexedDb: (await indexedDB.databases()).map((database) => database.name),
      caches: await caches.keys(),
      registrations: (await navigator.serviceWorker.getRegistrations()).map(
        (registration) => registration.scope,
      ),
    }));
    assert.deepEqual(initialStorage.local, ["travel-reference-state-v1"]);
    assert.deepEqual(initialStorage.session, []);
    assert.deepEqual(initialStorage.indexedDb, []);
    assert.ok(
      initialStorage.caches.every((name) =>
        name.startsWith("travel-command-center-reference-"),
      ),
    );
    assert.equal(initialStorage.registrations.length, 1);
    assert.deepEqual(await context.cookies(running.origin), []);

    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await openTab(page, "Itinerary", "Daily itinerary");
    await openTab(page, "Packing", "Team packing");
    const offlineCheck = page
      .locator(
        `[data-check-id^="reference-packing:${firstTravelerId}:"][aria-pressed="false"]`,
      )
      .first();
    const offlineId = await offlineCheck.getAttribute("data-check-id");
    assert.ok(offlineId);
    await offlineCheck.click();
    assert.equal(
      await page.locator(`[data-check-id="${offlineId}"]`).getAttribute("aria-pressed"),
      "true",
    );
    await page.waitForFunction(() => {
      const queue = JSON.parse(
        localStorage.getItem("travel-reference-queue-v1") || "[]",
      );
      return queue.length === 1;
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    await openTab(page, "Packing", "Team packing");
    assert.equal(
      await page.locator(`[data-check-id="${offlineId}"]`).getAttribute("aria-pressed"),
      "true",
    );

    await context.setOffline(false);
    await page.getByRole("button", { name: "Retry sync", exact: true }).waitFor();
    const retried = page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith("/api/checklist") &&
        candidate.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "Retry sync", exact: true }).click();
    assert.equal((await retried).status(), 200);
    await page.waitForFunction(() => {
      const queue = JSON.parse(
        localStorage.getItem("travel-reference-queue-v1") || "[]",
      );
      return queue.length === 0;
    });

    const persisted = await page.evaluate(async (id) => {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const response = await fetch("/api/state", { cache: "no-store" });
        const state = await response.json();
        if (state.checks[id] === true) return true;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return false;
    }, offlineId);
    assert.equal(persisted, true);

    const cachedUrls = await page.evaluate(async () => {
      const urls = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        urls.push(...(await cache.keys()).map((request) => request.url));
      }
      return urls;
    });
    for (const cachedUrl of cachedUrls) {
      const pathname = new URL(cachedUrl).pathname;
      assert.match(
        pathname,
        /^(?:\/|\/assets\/|\/manifest\.webmanifest$|\/(?:app-icon|favicon|icon|maskable-icon|apple-touch-icon)[^/]*\.(?:svg|png)$)/,
        cachedUrl,
      );
      assert.doesNotMatch(pathname, /^\/api\//, cachedUrl);
    }
    await context.close();
  } finally {
    await browser?.close();
    await stopProductionServer(running?.child);
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("share-safe production never requests or stores excluded detail categories", { timeout: 60_000 }, async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "travel-reference-share-browser-"));
  const port = 26600 + Math.floor(Math.random() * 300);
  let running;
  let browser;
  try {
    running = await startProductionServer({ dataDir, port, appPort: port + 1 });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: "allow" });
    const page = await context.newPage();
    const requestedUrls = [];
    page.on("request", (request) => requestedUrls.push(request.url()));

    const response = await page.goto(`${running.origin}/?share=1`, {
      waitUntil: "networkidle",
    });
    assert.equal(response?.status(), 200);
    await page.getByRole("heading", { name: /Your whole trip/i }).waitFor();
    assert.equal(
      requestedUrls.some((url) => /\/api\/trip(?:\?|$)/.test(url)),
      false,
    );
    assert.ok(requestedUrls.some((url) => /\/api\/state\?share=1$/.test(url)));

    const deliveredDom = await page.content();
    for (const excluded of excludedShareValues) {
      assert.equal(deliveredDom.includes(excluded), false, excluded);
    }

    const storage = await page.evaluate(() => ({
      privateState: localStorage.getItem("travel-reference-state-v1"),
      privateQueue: localStorage.getItem("travel-reference-queue-v1"),
      shareState: JSON.parse(
        localStorage.getItem("travel-reference-share-state-v1") || "{}",
      ),
    }));
    assert.equal(storage.privateState, null);
    assert.equal(storage.privateQueue, null);
    assert.deepEqual(Object.keys(storage.shareState.assignments || {}), []);
    assert.deepEqual(Object.keys(storage.shareState.pending || {}), []);
    await context.close();
  } finally {
    await browser?.close();
    await stopProductionServer(running?.child);
    await rm(dataDir, { recursive: true, force: true });
  }
});
