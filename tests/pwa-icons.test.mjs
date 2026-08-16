import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");

test("manifest icons exist at exact sizes without sensitive metadata", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(root, "public", "manifest.webmanifest"), "utf8"),
  );
  const expected = new Map([
    ["icon-192.png", 192],
    ["icon-512.png", 512],
    ["maskable-icon-512.png", 512],
    ["apple-touch-icon.png", 180],
    ["favicon-32.png", 32],
  ]);
  for (const icon of manifest.icons) {
    assert.ok(expected.has(icon.src.slice(1)), icon.src);
  }
  for (const [file, size] of expected) {
    const target = path.join(root, "public", file);
    await access(target);
    const metadata = await sharp(target).metadata();
    assert.equal(metadata.format, "png", file);
    assert.equal(metadata.width, size, file);
    assert.equal(metadata.height, size, file);
    assert.equal(metadata.exif, undefined, file);
    assert.equal(metadata.icc, undefined, file);
    assert.equal(metadata.iptc, undefined, file);
    assert.equal(metadata.xmp, undefined, file);
  }
  const svg = await readFile(path.join(root, "public", "app-icon.svg"), "utf8");
  assert.doesNotMatch(svg, /<metadata|<text|initial|family|europe/i);
});
