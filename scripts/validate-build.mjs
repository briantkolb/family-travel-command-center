import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function validateBuild() {
  const serverEntry = path.join(projectRoot, "dist", "server", "index.js");
  const clientAssets = path.join(projectRoot, "dist", "client", "assets");
  await Promise.all([access(serverEntry), access(clientAssets)]);
  const assets = await readdir(clientAssets);
  if (!assets.some((file) => file.endsWith(".js"))) {
    throw new Error("Production client JavaScript assets are missing");
  }
  if (!assets.some((file) => file.endsWith(".css"))) {
    throw new Error("Production client CSS assets are missing");
  }
  const entryUrl = pathToFileURL(serverEntry);
  entryUrl.searchParams.set("validation", `${process.pid}-${Date.now()}`);
  const built = await import(entryUrl.href);
  const handler = built.default;
  if (
    typeof handler !== "function" &&
    !(handler && typeof handler.fetch === "function")
  ) {
    throw new Error("dist/server/index.js has no supported request handler");
  }
  console.log("Validated production server entry and client assets.");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await validateBuild();
}
