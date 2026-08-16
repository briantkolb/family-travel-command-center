import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");

test("service-worker activation deletes only obsolete app-owned caches", async () => {
  const source = await readFile(path.join(root, "public", "sw.js"), "utf8");
  const listeners = new Map();
  const deleted = [];
  const context = {
    URL,
    Promise,
    fetch: async () => new Response("ok"),
    Response,
    caches: {
      keys: async () => [
        "travel-command-center-reference-shell-v1",
        "travel-command-center-reference-shell-v2",
        "travel-command-center-reference-shell-v3",
        "unrelated-application-cache",
      ],
      delete: async (key) => {
        deleted.push(key);
        return true;
      },
      open: async () => ({ addAll: async () => {}, put: async () => {} }),
      match: async () => undefined,
    },
    self: {
      location: { origin: "http://127.0.0.1:3000" },
      clients: { claim: async () => {} },
      skipWaiting: async () => {},
      addEventListener: (name, handler) => listeners.set(name, handler),
    },
  };
  vm.runInNewContext(source, context);
  let activation;
  listeners.get("activate")({ waitUntil: (promise) => (activation = promise) });
  await activation;
  assert.deepEqual(deleted, [
    "travel-command-center-reference-shell-v1",
    "travel-command-center-reference-shell-v2",
  ]);

  let responded = false;
  listeners.get("fetch")({
    request: {
      method: "GET",
      mode: "cors",
      url: "http://127.0.0.1:3000/api/state",
    },
    respondWith: () => {
      responded = true;
    },
  });
  assert.equal(responded, false, "API reads are never cached");
  assert.match(source, /cache\.put\(request, copy\)/);
  assert.match(source, /isShareSafe \? Response\.error\(\)/);
});
