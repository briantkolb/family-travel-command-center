import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(projectRoot, "node_modules", "vinext", "dist", "cli.js");

export function runVinext(command, inputArgs = [], { timeoutMs = 0 } = {}) {
  const args = [...inputArgs];
  if (
    command === "dev" &&
    !args.includes("--hostname") &&
    !args.includes("-H")
  ) {
    args.push("--hostname", process.env.DEV_HOST || "127.0.0.1");
  }

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, command, ...args], {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
    });
    let timedOut = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
        }, timeoutMs)
      : null;
    timer?.unref();

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (timer) clearTimeout(timer);
      if (timedOut) reject(new Error(`${command} exceeded ${timeoutMs}ms`));
      else if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });

    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.once(signal, () => child.kill(signal));
    }
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [command, ...args] = process.argv.slice(2);
  if (!command) throw new Error("Usage: node scripts/vinext-cli.mjs <command>");
  await runVinext(command, args);
}
