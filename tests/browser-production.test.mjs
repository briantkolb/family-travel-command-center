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
  referenceTrip.identity.private_validation_canary,
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

test("production hydrates, navigates, persists state, and queues private changes offline", { timeout: 90_000 }, async () => {
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
    assert.deepEqual(initialStorage.local, [
      "travel-reference-private-data-v1",
      "travel-reference-state-v1",
    ]);
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
    await page.getByRole("heading", { name: /Your whole trip/i }).waitFor();
    assert.equal(await page.locator('[data-testid="share-safe-view"]').count(), 0);
    await openTab(page, "Itinerary", "Daily itinerary");
    await openTab(page, "Packing", "Team packing");
    assert.equal(
      await page.locator(`[data-check-id="${firstId}"]`).getAttribute("aria-pressed"),
      "true",
    );
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

    const shareApiRequests = [];
    page.on("request", (request) => {
      if (/\/api\/(?:trip|packing|state)(?:\?|$)/.test(request.url())) {
        shareApiRequests.push(request.url());
      }
    });
    await page.goto(`${running.origin}/?share=1`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /Northstar Isles coastal highlights/i }).waitFor();
    assert.deepEqual(shareApiRequests, []);
    assert.equal(await page.getByText(/Private view/i).count(), 0);
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: /Northstar Isles coastal highlights/i }).waitFor();
    assert.equal(await page.getByRole("heading", { name: /Your whole trip/i }).count(), 0);
    await context.setOffline(false);

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

test("private bootstrap fails explicitly without cached data and share mode never reads a populated private cache", { timeout: 60_000 }, async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "travel-reference-private-cache-browser-"));
  const port = 26400 + Math.floor(Math.random() * 100);
  let running;
  let browser;
  try {
    running = await startProductionServer({ dataDir, port, appPort: port + 1 });
    browser = await chromium.launch({ headless: true });

    const freshContext = await browser.newContext({ serviceWorkers: "block" });
    const unavailablePage = await freshContext.newPage();
    await unavailablePage.route(/\/api\/(?:trip|packing)(?:\?|$)/, (route) =>
      route.abort("internetdisconnected"),
    );
    await unavailablePage.goto(running.origin, { waitUntil: "domcontentloaded" });
    await unavailablePage.getByRole("heading", { name: "Reconnect to load this trip" }).waitFor();
    assert.equal(await unavailablePage.locator('[data-testid="private-reconnect-view"]').count(), 1);
    assert.equal(await unavailablePage.locator('[data-testid="share-safe-view"]').count(), 0);
    assert.deepEqual(await unavailablePage.evaluate(() => Object.keys(localStorage)), []);
    await freshContext.close();

    const offlineShellContext = await browser.newContext({ serviceWorkers: "allow" });
    const offlineShellPage = await offlineShellContext.newPage();
    await offlineShellPage.goto(running.origin, { waitUntil: "networkidle" });
    await offlineShellPage.getByRole("heading", { name: /Your whole trip/i }).waitFor();
    await offlineShellPage.evaluate(() => navigator.serviceWorker.ready);
    await offlineShellPage.reload({ waitUntil: "networkidle" });
    assert.equal(
      await offlineShellPage.evaluate(() => Boolean(navigator.serviceWorker.controller)),
      true,
    );
    await offlineShellPage.evaluate(() => localStorage.clear());
    await offlineShellContext.setOffline(true);
    await offlineShellPage.reload({ waitUntil: "domcontentloaded" });
    await offlineShellPage
      .getByRole("heading", { name: "Reconnect to load this trip" })
      .waitFor();
    assert.equal(await offlineShellPage.locator('[data-testid="private-reconnect-view"]').count(), 1);
    assert.equal(await offlineShellPage.locator('[data-testid="share-safe-view"]').count(), 0);
    await offlineShellContext.close();

    const cachedContext = await browser.newContext({ serviceWorkers: "allow" });
    const cachedPage = await cachedContext.newPage();
    await cachedPage.goto(running.origin, { waitUntil: "networkidle" });
    await cachedPage.getByRole("heading", { name: /Your whole trip/i }).waitFor();
    assert.equal(
      await cachedPage.evaluate(() => localStorage.hasOwnProperty("travel-reference-private-data-v1")),
      true,
    );

    await cachedContext.addInitScript(() => {
      window.__privateCacheReads = [];
      const originalGetItem = Storage.prototype.getItem;
      Storage.prototype.getItem = function getItem(key) {
        if (key === "travel-reference-private-data-v1") window.__privateCacheReads.push(key);
        return originalGetItem.call(this, key);
      };
    });
    const shareRequests = [];
    cachedPage.on("request", (request) => {
      if (/\/api\/(?:trip|packing|state)(?:\?|$)/.test(request.url())) {
        shareRequests.push(request.url());
      }
    });
    await cachedPage.goto(`${running.origin}/?share=1`, { waitUntil: "networkidle" });
    await cachedPage.getByRole("heading", { name: /Northstar Isles coastal highlights/i }).waitFor();
    assert.deepEqual(await cachedPage.evaluate(() => window.__privateCacheReads), []);
    assert.deepEqual(shareRequests, []);
    assert.equal(await cachedPage.locator('[data-testid="share-safe-view"]').count(), 1);
    assert.equal(await cachedPage.getByRole("heading", { name: /Your whole trip/i }).count(), 0);
    await cachedContext.close();
  } finally {
    await browser?.close();
    await stopProductionServer(running?.child);
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("direct share-safe navigation hydrates cleanly before normal private bootstrap", { timeout: 60_000 }, async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "travel-reference-hydration-browser-"));
  const port = 26500 + Math.floor(Math.random() * 100);
  let running;
  let browser;
  let shareContext;
  let normalContext;
  try {
    running = await startProductionServer({ dataDir, port, appPort: port + 1 });
    browser = await chromium.launch({ headless: true });

    shareContext = await browser.newContext({ serviceWorkers: "allow" });
    const sharePage = await shareContext.newPage();
    const shareConsoleErrors = [];
    const sharePageErrors = [];
    const shareRequests = [];
    sharePage.on("console", (message) => {
      if (message.type() === "error") shareConsoleErrors.push(message.text());
    });
    sharePage.on("pageerror", (error) => sharePageErrors.push(error.message));
    sharePage.on("request", (request) => shareRequests.push(request.url()));

    const shareResponse = await sharePage.goto(`${running.origin}/?share=1`, {
      waitUntil: "networkidle",
    });
    assert.equal(shareResponse?.status(), 200);
    const shareResponseHtml = await shareResponse.text();
    await sharePage.getByRole("heading", { name: /Northstar Isles coastal highlights/i }).waitFor();
    assert.equal(await sharePage.locator("main.share-mode").count(), 1);
    assert.equal(
      shareRequests.some((url) => /\/api\/trip(?:\?|$)/.test(url)),
      false,
    );
    assert.equal(shareRequests.some((url) => /\/api\/(?:state|packing)(?:\?|$)/.test(url)), false);
    assert.deepEqual(shareConsoleErrors, []);
    assert.deepEqual(sharePageErrors, []);

    const shareDom = await sharePage.content();
    assert.equal(await sharePage.locator(".private-field").count(), 0);
    for (const excluded of excludedShareValues) {
      assert.equal(shareResponseHtml.includes(excluded), false, excluded);
      assert.equal(shareDom.includes(excluded), false, excluded);
    }

    const shareStorage = await sharePage.evaluate(async () => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
      caches: await caches.keys(),
      registrations: (await navigator.serviceWorker.getRegistrations()).length,
      manifestLinks: document.querySelectorAll('link[rel="manifest"]').length,
    }));
    assert.deepEqual(shareStorage.local, []);
    assert.deepEqual(shareStorage.session, []);
    assert.deepEqual(shareStorage.caches, []);
    assert.equal(shareStorage.registrations, 0);
    assert.equal(shareStorage.manifestLinks, 0);
    assert.equal(await sharePage.getByText(/Private view/i).count(), 0);
    assert.equal(await sharePage.getByRole("button", { name: "Packing", exact: true }).count(), 0);
    await shareContext.close();
    shareContext = undefined;

    normalContext = await browser.newContext({ serviceWorkers: "allow" });
    const normalPage = await normalContext.newPage();
    const normalConsoleErrors = [];
    const normalPageErrors = [];
    const normalRequests = [];
    normalPage.on("console", (message) => {
      if (message.type() === "error") normalConsoleErrors.push(message.text());
    });
    normalPage.on("pageerror", (error) => normalPageErrors.push(error.message));
    normalPage.on("request", (request) => normalRequests.push(request.url()));

    const normalResponse = await normalPage.goto(running.origin, {
      waitUntil: "networkidle",
    });
    assert.equal(normalResponse?.status(), 200);
    await normalPage.getByRole("heading", { name: /Your whole trip/i }).waitFor();
    await normalPage
      .getByRole("button", { name: "Open share-safe view", exact: true })
      .waitFor();
    await openTab(normalPage, "Lodging", "Lodging & access");
    await normalPage.locator(".lodging-card").first().waitFor();
    assert.ok(normalRequests.some((url) => /\/api\/trip(?:\?|$)/.test(url)));
    assert.ok(normalRequests.some((url) => /\/api\/packing(?:\?|$)/.test(url)));
    assert.deepEqual(normalConsoleErrors, []);
    assert.deepEqual(normalPageErrors, []);
  } finally {
    await shareContext?.close();
    await normalContext?.close();
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
    await page.getByRole("heading", { name: /Northstar Isles coastal highlights/i }).waitFor();
    assert.equal(
      requestedUrls.some((url) => /\/api\/trip(?:\?|$)/.test(url)),
      false,
    );
    assert.equal(requestedUrls.some((url) => /\/api\/(?:state|packing)(?:\?|$)/.test(url)), false);

    const deliveredDom = await page.content();
    for (const excluded of excludedShareValues) {
      assert.equal(deliveredDom.includes(excluded), false, excluded);
    }

    const storage = await page.evaluate(async () => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
      caches: await caches.keys(),
      registrations: (await navigator.serviceWorker.getRegistrations()).length,
    }));
    assert.deepEqual(storage.local, []);
    assert.deepEqual(storage.session, []);
    assert.deepEqual(storage.caches, []);
    assert.equal(storage.registrations, 0);
    await context.close();
  } finally {
    await browser?.close();
    await stopProductionServer(running?.child);
    await rm(dataDir, { recursive: true, force: true });
  }
});
