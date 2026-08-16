import { runVinext } from "./vinext-cli.mjs";
import { validateBuild } from "./validate-build.mjs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const timeoutMs = Number(process.env.BUILD_TIMEOUT_MS || 180_000);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await Promise.all([
  rm(path.join(projectRoot, "dist"), { recursive: true, force: true }),
  rm(path.join(projectRoot, ".vinext"), { recursive: true, force: true }),
]);
await runVinext("build", [], { timeoutMs });
await validateBuild();
