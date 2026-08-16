import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "public", "app-icon.svg");
const source = await readFile(sourcePath);
const targets = [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["maskable-icon-512.png", 512],
  ["apple-touch-icon.png", 180],
  ["favicon-32.png", 32],
];

await Promise.all(
  targets.map(([name, size]) =>
    sharp(source)
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toFile(path.join(root, "public", name)),
  ),
);
await copyFile(sourcePath, path.join(root, "public", "favicon.svg"));
console.log(`Generated ${targets.length} neutral PWA raster assets.`);
