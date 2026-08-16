import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tests = (await readdir(path.join(projectRoot, "tests")))
  .filter((file) => file.endsWith(".test.mjs"))
  .sort()
  .map((file) => path.join("tests", file));

const child = spawn(process.execPath, ["--test", ...tests], {
  cwd: projectRoot,
  env: process.env,
  stdio: "inherit",
});
const code = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (value) => resolve(value ?? 1));
});
process.exitCode = code;
