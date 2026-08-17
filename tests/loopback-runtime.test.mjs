import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  startProductionServer,
  stopProductionServer,
} from "./helpers/production-server.mjs";

function nonLoopbackAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter(
      (entry) =>
        entry &&
        entry.family === "IPv4" &&
        !entry.internal &&
        entry.address !== "0.0.0.0",
    )
    .map((entry) => entry.address);
}

async function assertNotReachable(address, port) {
  try {
    const response = await fetch(`http://${address}:${port}/api/health`, {
      signal: AbortSignal.timeout(750),
    });
    assert.fail(`Default listener was reachable on ${address}: ${response.status}`);
  } catch (error) {
    if (error?.code === "ERR_ASSERTION") throw error;
  }
}

async function requestWithHost(origin, pathname, { host, method = "GET", body } = {}) {
  const target = new URL(origin);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: pathname,
        method,
        headers: {
          host,
          ...(body === undefined
            ? {}
            : { "content-type": "application/json", origin: `http://${host}` }),
        },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      },
    );
    request.on("error", reject);
    if (body !== undefined) request.end(JSON.stringify(body));
    else request.end();
  });
}

for (const [mode, base] of [
  ["start", 27200],
  ["dev", 27600],
]) {
  test(`${mode} defaults to a loopback-only listener`, { timeout: 40_000 }, async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), `travel-reference-${mode}-`));
    const port = base + Math.floor(Math.random() * 300);
    let running;
    try {
      running = await startProductionServer({
        dataDir,
        port,
        appPort: port + 1,
        mode,
        explicitHost: false,
      });
      assert.match(running.logs.join(""), new RegExp(`http://127\\.0\\.0\\.1:${port}`));
      for (const address of nonLoopbackAddresses()) {
        await assertNotReachable(address, port);
      }
      if (mode === "dev") {
        for (const blocked of [
          "/app/data/trip.json",
          "/app/data/packing.json",
          "/data/northstar-isles-trip.json",
          "/.local-state/travel-command-center-reference.sqlite",
          "/package-lock.json",
          "/server.mjs",
          "/.npmrc",
          "/@fs/C:/Users/example/private.txt",
          "/%64ata/northstar-isles-trip.json",
          "/%2564ata/northstar-isles-trip.json",
          "/app/%64ata/trip.json",
          "/app/data/%74rip.json",
          "/app/%2564ata/packing.json",
          "/app/data/future-private-file.json",
          "/bad%ZZpath",
        ]) {
          const response = await fetch(`${running.origin}${blocked}`);
          assert.equal(response.status, 404, blocked);
        }
        const safeSeed = await fetch(`${running.origin}/app/data/trip-share.json`);
        assert.equal(safeSeed.status, 200);
        assert.doesNotMatch(await safeSeed.text(), /SECRET_CANARY/i);
      }
    } finally {
      await stopProductionServer(running?.child);
      await rm(dataDir, { recursive: true, force: true });
    }
  });
}

test("private routes reject unapproved Hosts and accept explicit deployment hosts", { timeout: 60_000 }, async () => {
  const firstDataDir = await mkdtemp(path.join(tmpdir(), "travel-reference-host-default-"));
  const secondDataDir = await mkdtemp(path.join(tmpdir(), "travel-reference-host-explicit-"));
  const firstPort = 27900 + Math.floor(Math.random() * 100);
  const secondPort = firstPort + 101;
  let first;
  let second;
  try {
    first = await startProductionServer({
      dataDir: firstDataDir,
      port: firstPort,
      appPort: firstPort + 1,
    });
    for (const route of ["/api/trip", "/api/packing", "/api/state"]) {
      assert.equal(
        await requestWithHost(first.origin, route, { host: "rebind.example" }),
        403,
        route,
      );
    }
    for (const [route, method, body] of [
      ["/api/checklist", "PUT", { id: "prep:host-test", checked: true }],
      ["/api/checklist/import", "POST", { checks: {} }],
      ["/api/esim-assignment", "PUT", { slot: 1, person: "" }],
      ["/api/pending", "PUT", { id: "demo_departure_gate", value: "D1" }],
    ]) {
      const status = await requestWithHost(first.origin, route, {
        host: "rebind.example",
        method,
        body,
      });
      assert.equal(status, 403, route);
    }
    assert.equal(
      await requestWithHost(first.origin, "/api/health", { host: `localhost:${firstPort}` }),
      200,
    );

    second = await startProductionServer({
      dataDir: secondDataDir,
      port: secondPort,
      appPort: secondPort + 1,
      allowedHosts: "family.example.test",
    });
    assert.equal(
      await requestWithHost(second.origin, "/api/trip", { host: "family.example.test" }),
      200,
    );
  } finally {
    await stopProductionServer(first?.child);
    await stopProductionServer(second?.child);
    await rm(firstDataDir, { recursive: true, force: true });
    await rm(secondDataDir, { recursive: true, force: true });
  }
});
