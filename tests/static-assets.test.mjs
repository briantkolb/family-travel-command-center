import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { staticAsset } from "../lib/static-assets.mjs";

test("portable static asset lookup handles URL paths without allowing traversal", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "travel-reference-assets-"));
  try {
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "entry-test.js"), "export {};\n");
    const asset = await staticAsset(root, "/assets/entry-test.js");
    assert.ok(asset);
    assert.equal(asset.contentType, "text/javascript; charset=utf-8");
    assert.match(asset.cacheControl, /immutable/);
    assert.equal(await staticAsset(root, "/../outside.txt"), null);
    assert.equal(await staticAsset(root, "/missing.js"), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
