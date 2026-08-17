import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const appUrl = "http://127.0.0.1:3000";
const server = spawn(process.execPath, [path.join(root, "server.mjs")], {
  cwd: root,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: "3000",
    APP_INTERNAL_HOST: "127.0.0.1",
    APP_INTERNAL_PORT: "3001",
  },
  stdio: "inherit",
  windowsHide: true,
});

let stopping = false;
let serverExit;
const exited = new Promise((resolve) => {
  server.once("exit", (code, signal) => {
    serverExit = { code, signal };
    resolve(serverExit);
  });
});

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitUntilReady() {
  const startedAt = Date.now();
  await delay(300);
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (serverExit) throw new Error("The local server exited before it was ready.");
    try {
      const response = await fetch(appUrl, {
        cache: "no-store",
        signal: AbortSignal.timeout(1_000),
      });
      const html = await response.text();
      if (response.ok && html.includes("Family Travel Command Center")) return;
    } catch {
      // The production process normally needs a few seconds to initialize.
    }
    if (attempt > 0 && attempt % 30 === 0) {
      console.log(`Still starting... ${Math.round((Date.now() - startedAt) / 1000)} seconds elapsed.`);
    }
    await delay(500);
  }
  throw new Error("The local server did not become ready within 150 seconds.");
}

function openBrowser() {
  if (process.env.FTC_SKIP_BROWSER_OPEN === "1") {
    console.log(`Browser opening skipped for verification. Open ${appUrl}`);
    return;
  }

  let command;
  let args;
  if (process.platform === "win32") {
    command = "rundll32.exe";
    args = ["url.dll,FileProtocolHandler", appUrl];
  } else if (process.platform === "darwin") {
    command = "open";
    args = [appUrl];
  } else {
    command = "xdg-open";
    args = [appUrl];
  }

  const opener = spawn(command, args, {
    cwd: path.parse(root).root,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  opener.once("error", () => {
    console.warn(`Could not open a browser automatically. Open ${appUrl}`);
  });
  opener.unref();
}

function stopServer() {
  if (stopping) return;
  stopping = true;
  console.log("\nStopping the local Family Travel Command Center...");
  if (!server.killed) server.kill("SIGTERM");
}

process.once("SIGINT", stopServer);
process.once("SIGTERM", stopServer);

try {
  await waitUntilReady();
  console.log(`\nReady. Opening ${appUrl} in your default browser...`);
  openBrowser();
} catch (error) {
  console.error(`\nERROR: ${error.message}`);
  stopServer();
  process.exitCode = 1;
}

const result = await exited;
if (!stopping && result.code && result.code !== 0) {
  console.error(`The local server exited with code ${result.code}.`);
  process.exitCode = result.code;
}
