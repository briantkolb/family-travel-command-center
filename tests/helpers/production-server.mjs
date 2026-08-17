import { spawn } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function signalProcess(child, signal) {
  if (child.exitCode !== null) return;
  if (process.platform === "win32") child.kill(signal);
  else process.kill(-child.pid, signal);
}

export async function startProductionServer({
  dataDir,
  port,
  appPort,
  mode = "start",
  explicitHost = true,
  allowedHosts = "",
}) {
  const logs = [];
  const environment = {
    ...process.env,
    NODE_NO_WARNINGS: "1",
    APP_INTERNAL_HOST: "127.0.0.1",
    DATA_DIR: dataDir,
    PORT: String(port),
    APP_INTERNAL_PORT: String(appPort),
    ALLOWED_HOSTS: allowedHosts,
  };
  if (explicitHost) environment.HOST = "127.0.0.1";
  else delete environment.HOST;
  const child = spawn(
    process.execPath,
    ["server.mjs", ...(mode === "dev" ? ["--dev"] : [])],
    {
    cwd: root,
    detached: process.platform !== "win32",
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early:\n${logs.join("")}`);
    }
    try {
      const health = await fetch(`${origin}/api/health`);
      const rootResponse = health.ok ? await fetch(`${origin}/`) : null;
      if (health.ok && rootResponse?.ok) return { child, logs, origin };
    } catch {}
    await delay(100);
  }
  signalProcess(child, "SIGKILL");
  throw new Error(`Server did not start:\n${logs.join("")}`);
}

export async function stopProductionServer(child) {
  if (!child || child.exitCode !== null) return;
  signalProcess(child, "SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(5_000).then(() => signalProcess(child, "SIGKILL")),
  ]);
}

export async function waitForResponse(url, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await delay(100);
  }
  throw new Error(`URL did not become healthy: ${url}`);
}
