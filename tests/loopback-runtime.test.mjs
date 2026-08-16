import assert from "node:assert/strict";
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
    } finally {
      await stopProductionServer(running?.child);
      await rm(dataDir, { recursive: true, force: true });
    }
  });
}
