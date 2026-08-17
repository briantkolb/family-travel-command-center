import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  startProductionServer,
  stopProductionServer,
} from "./helpers/production-server.mjs";

const root = path.resolve(import.meta.dirname, "..");
const referenceTrip = JSON.parse(
  await readFile(path.join(root, "data", "northstar-isles-trip.json"), "utf8"),
);
const firstTraveler = referenceTrip.travelers[0];
const secondTraveler = referenceTrip.travelers[1] || firstTraveler;
const firstProfileSlot = referenceTrip.connectivity.profiles[0]?.slot;

async function jsonRequest(origin, pathname, method = "GET", body) {
  const response = await fetch(`${origin}${pathname}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await response.json();
  return { response, value };
}

test("API validation and SQLite state remain reliable across clients and restart", { timeout: 40_000 }, async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "travel-reference-state-"));
  const port = Number(
    process.env.TRAVEL_REFERENCE_TEST_PORT ||
      24600 + Math.floor(Math.random() * 400),
  );
  let running;
  try {
    running = await startProductionServer({ dataDir, port, appPort: port + 1 });
    let result = await jsonRequest(running.origin, "/api/health");
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.value, { status: "ok" });

    result = await jsonRequest(running.origin, "/api/state?share=1");
    assert.equal(result.response.status, 403);
    assert.deepEqual(result.value, {
      error: "Private state is unavailable in share-safe mode.",
    });

    result = await jsonRequest(running.origin, "/api/trip?share=1");
    assert.equal(result.response.status, 404);

    result = await jsonRequest(
      running.origin,
      "/api/esim-assignment?share=1",
      "PUT",
      { slot: firstProfileSlot ?? 1, person: firstTraveler.display_name },
    );
    assert.equal(result.response.status, 403);

    result = await jsonRequest(
      running.origin,
      "/api/checklist?share=1",
      "PUT",
      { id: "prep:share:blocked", checked: true },
    );
    assert.equal(result.response.status, 403);

    result = await jsonRequest(
      running.origin,
      "/api/checklist/import?share=1",
      "POST",
      { checks: { "prep:share:blocked": true } },
    );
    assert.equal(result.response.status, 403);

    result = await jsonRequest(
      running.origin,
      "/api/pending?share=1",
      "PUT",
      {
        id: referenceTrip.pending_updates[0]?.id || "share-safe-pending",
        value: "Should not be accepted",
      },
    );
    assert.equal(result.response.status, 403);

    let rawResponse = await fetch(`${running.origin}/api/checklist`, {
      method: "PUT",
      body: JSON.stringify({ id: "prep:missing-content-type", checked: true }),
    });
    assert.equal(rawResponse.status, 415);

    rawResponse = await fetch(`${running.origin}/api/checklist`, {
      method: "PUT",
      headers: { "content-type": "application/json", origin: "https://attacker.invalid" },
      body: JSON.stringify({ id: "prep:cross-origin", checked: true }),
    });
    assert.equal(rawResponse.status, 403);

    rawResponse = await fetch(`${running.origin}/api/checklist`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    });
    assert.equal(rawResponse.status, 400);

    rawResponse = await fetch(`${running.origin}/api/checklist`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "prep:too-large", checked: true, padding: "x".repeat(128_100) }),
    });
    assert.equal(rawResponse.status, 413);

    result = await jsonRequest(running.origin, "/api/checklist/import", "POST", {
      checks: {
        [`reference-packing:${firstTraveler.id}:imported`]: true,
        "prep:departure-preparation:imported": false,
        "packing:predecessor:rejected": true,
      },
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.value.imported, 2);

    result = await jsonRequest(running.origin, "/api/checklist/import", "POST", {
      checks: { [`reference-packing:${secondTraveler.id}:second-import`]: true },
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.value.imported, 0);
    assert.equal(result.value.reason, "server-state-exists");

    result = await jsonRequest(running.origin, "/api/checklist", "PUT", {
      id: `reference-packing:${firstTraveler.id}:test-stable-id`,
      checked: true,
    });
    assert.equal(result.response.status, 200);
    result = await jsonRequest(running.origin, "/api/checklist", "PUT", {
      id: "packing:predecessor:test-stable-id",
      checked: true,
    });
    assert.equal(result.response.status, 400);

    if (firstProfileSlot !== undefined) {
      result = await jsonRequest(running.origin, "/api/esim-assignment", "PUT", {
        slot: firstProfileSlot,
        person: firstTraveler.display_name,
      });
      assert.equal(result.response.status, 200);
      result = await jsonRequest(running.origin, "/api/esim-assignment", "PUT", {
        slot: firstProfileSlot,
        person: "Unlisted Traveler",
      });
      assert.equal(result.response.status, 400);
    }

    result = await jsonRequest(running.origin, "/api/pending", "PUT", {
      id: "demo_departure_gate",
      value: "Demonstration gate D4",
    });
    assert.equal(result.response.status, 200);
    result = await jsonRequest(running.origin, "/api/pending", "PUT", {
      id: "unlisted_pending_value",
      value: "Rejected",
    });
    assert.equal(result.response.status, 400);

    result = await jsonRequest(running.origin, "/api/not-a-route");
    assert.equal(result.response.status, 404);
    assert.deepEqual(result.value, { error: "Not found" });

    const secondClient = (await jsonRequest(running.origin, "/api/state")).value;
    assert.equal(
      secondClient.checks[`reference-packing:${firstTraveler.id}:test-stable-id`],
      true,
    );
    if (firstProfileSlot !== undefined) {
      assert.equal(
        secondClient.assignments[String(firstProfileSlot)],
        firstTraveler.display_name,
      );
    }
    assert.equal(secondClient.pending.demo_departure_gate, "Demonstration gate D4");

    await stopProductionServer(running.child);
    running = await startProductionServer({
      dataDir,
      port: port + 2,
      appPort: port + 3,
    });
    const afterRestart = (await jsonRequest(running.origin, "/api/state")).value;
    assert.equal(
      afterRestart.checks[`reference-packing:${firstTraveler.id}:test-stable-id`],
      true,
    );
    if (firstProfileSlot !== undefined) {
      assert.equal(
        afterRestart.assignments[String(firstProfileSlot)],
        firstTraveler.display_name,
      );
    }
    assert.equal(afterRestart.pending.demo_departure_gate, "Demonstration gate D4");

    const databaseFiles = await readdir(dataDir);
    assert.ok(databaseFiles.includes("travel-command-center-reference.sqlite"));
    assert.equal(databaseFiles.some((name) => /predecessor/i.test(name)), false);
  } finally {
    await stopProductionServer(running?.child);
    await rm(dataDir, { recursive: true, force: true });
  }
});
