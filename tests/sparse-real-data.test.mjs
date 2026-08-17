import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "@playwright/test";
import {
  PRIVATE_BUILD_VALIDATION_CANARY,
  validateCanonicalTrip,
  withPrivateBuildValidationCanary,
} from "../lib/canonical-trip.mjs";
import { buildPackingData } from "../lib/packing-data.mjs";
import { diagnoseShareProfile, toShareSafeTrip } from "../lib/share-safe-trip.mjs";
import {
  startProductionServer,
  stopProductionServer,
} from "./helpers/production-server.mjs";

const root = path.resolve(import.meta.dirname, "..");
const sparseTrip = JSON.parse(
  await readFile(path.join(root, "tests", "fixtures", "sparse-real-trip.json"), "utf8"),
);
const sparsePackingSource = await readFile(
  path.join(root, "tests", "fixtures", "sparse-real-packing.md"),
  "utf8",
);
const sparsePacking = buildPackingData(sparsePackingSource, sparseTrip);

async function openTab(page, name, heading) {
  await page.getByRole("button", { name, exact: true }).first().click();
  await page.getByRole("heading", { name: heading, exact: true }).waitFor();
}

test("sparse real-data canonical inputs preserve strict structure and sharing", () => {
  const result = validateCanonicalTrip(sparseTrip);
  assert.deepEqual(result.travelerNames, ["Alex Morgan", "Jamie Morgan"]);
  assert.deepEqual(result.connectivitySlots, []);
  assert.deepEqual(Object.keys(sparsePacking), result.travelerNames);
  assert.equal(sparsePacking["Alex Morgan"].length, 1);
  assert.equal(sparsePacking["Jamie Morgan"].length, 1);
  assert.equal(diagnoseShareProfile(sparseTrip).status, "valid");
  const shareTrip = toShareSafeTrip(sparseTrip);
  assert.deepEqual(shareTrip, sparseTrip.sharing);
  const generatedPrivateTrip = withPrivateBuildValidationCanary(sparseTrip);
  assert.equal(
    generatedPrivateTrip.identity.private_validation_canary,
    PRIVATE_BUILD_VALIDATION_CANARY,
  );
  assert.equal(
    JSON.stringify(shareTrip).includes(PRIVATE_BUILD_VALIDATION_CANARY),
    false,
  );

  for (const separator of ["-", "–"]) {
    const invalidPacking = sparsePackingSource.replace(
      "## Alex Morgan — Traveler",
      `## Alex Morgan ${separator} Traveler`,
    );
    assert.throws(
      () => buildPackingData(invalidPacking, sparseTrip),
      /literal em dash separator \(—\)/,
    );
  }

  const invalidAirports = structuredClone(sparseTrip);
  invalidAirports.airports.LHR = 123;
  assert.throws(
    () => validateCanonicalTrip(invalidAirports),
    /trip\.airports\.LHR must be a string/,
  );

  const invalidOnwardSteps = structuredClone(sparseTrip);
  invalidOnwardSteps.onward_steps["LHR-CDG"] = { instruction: "Continue" };
  assert.throws(
    () => validateCanonicalTrip(invalidOnwardSteps),
    /trip\.onward_steps\.LHR-CDG must be a string/,
  );

  const invalidVaultItem = structuredClone(sparseTrip);
  invalidVaultItem.demo_vault_groups = [
    { title: "Incomplete", items: [{ label: "Booking" }] },
  ];
  assert.throws(
    () => validateCanonicalTrip(invalidVaultItem),
    /demo_vault_groups\[0\]\.items\[0\]\.value must be a non-empty string/,
  );
  invalidVaultItem.demo_vault_groups[0].items[0] = { value: "DEMO-BOOKING" };
  assert.throws(
    () => validateCanonicalTrip(invalidVaultItem),
    /demo_vault_groups\[0\]\.items\[0\]\.label must be a non-empty string/,
  );
});

test(
  "a sparse real-data trip renders optional sections without fabricated facts",
  { timeout: 60_000 },
  async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "travel-reference-sparse-"));
    const port = 26700 + Math.floor(Math.random() * 200);
    let running;
    let browser;
    try {
      running = await startProductionServer({ dataDir, port, appPort: port + 1 });
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({ serviceWorkers: "block" });
      const page = await context.newPage();
      const consoleErrors = [];
      const pageErrors = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.route(/\/api\/trip(?:\?|$)/, (route) =>
        route.fulfill({ json: sparseTrip }),
      );
      await page.route(/\/api\/packing(?:\?|$)/, (route) =>
        route.fulfill({ json: sparsePacking }),
      );

      await page.goto(running.origin, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: /London/ }).first().waitFor();
      await openTab(page, "Itinerary", "Daily itinerary");
      await openTab(page, "Flights + Transport", "Flights & transportation");
      await openTab(page, "Lodging", "Lodging & access");
      assert.equal(await page.locator(".lodging-card").count(), 1);
      await page
        .getByRole("heading", { name: "Example London Stay", exact: true })
        .waitFor();
      await page
        .getByText("1 Example Square, London", { exact: true })
        .waitFor();
      assert.equal(await page.getByRole("link", { name: /Call / }).count(), 0);
      assert.equal(await page.getByRole("link", { name: "WhatsApp" }).count(), 0);
      assert.equal(await page.getByText("Equipment note:").count(), 0);
      assert.equal(await page.getByRole("heading", { name: /Luggage options/ }).count(), 0);
      assert.equal(await page.locator(".tone-undefined").count(), 0);

      await openTab(page, "Cruise", "Coastal vessel command center");
      await page
        .getByText("No cruise or vessel details added for this trip.", {
          exact: true,
        })
        .waitFor();
      await openTab(page, "Tours", "Tours & tickets");
      await page.getByRole("heading", { name: "Public garden visit" }).waitFor();
      await openTab(page, "Packing", "Team packing");
      assert.equal(
        await page.locator('[data-check-id^="reference-packing:"]').count(),
        1,
      );
      await openTab(page, "Connectivity", "Connectivity & eSIMs");
      await page.getByText("No connectivity profiles added.", { exact: true }).waitFor();
      await openTab(page, "Safety & Accessibility", "Safety & accessibility");
      await page.getByText("Allow extra transfer time", { exact: true }).waitFor();
      await openTab(page, "Bookings + Access", "Private booking references");
      await page.getByText("No booking references stored here.", { exact: true }).waitFor();
      await openTab(page, "Pending", "Pending live updates");
      await page.getByText("Confirm the airport pickup time.", { exact: true }).waitFor();
      await openTab(page, "Home Preparation", "Preparation & return");
      await page.getByText("Review the confirmed itinerary", { exact: true }).waitFor();

      assert.doesNotMatch(await page.locator("body").innerText(), /undefined|null/i);

      assert.deepEqual(consoleErrors, []);
      assert.deepEqual(pageErrors, []);
      await context.close();
    } finally {
      await browser?.close();
      await stopProductionServer(running?.child);
      await rm(dataDir, { recursive: true, force: true });
    }
  },
);
