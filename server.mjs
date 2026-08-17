import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { validDemoAssignment } from "./lib/reference-policy.mjs";
import { serveStaticAsset } from "./lib/static-assets.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const appPort = Number(process.env.APP_INTERNAL_PORT || 3001);
const host = process.env.HOST || "127.0.0.1";
const appHost = process.env.APP_INTERNAL_HOST || "127.0.0.1";
const development = process.argv.includes("--dev");
const appCommand = development ? "dev" : "start";
const dataDir = process.env.DATA_DIR || path.join(root, ".local-state");
const clientDirectory = path.join(root, "dist", "client");
const tripPath = path.join(root, "app", "data", "trip.json");
const packingPath = path.join(root, "app", "data", "packing.json");
const vinextCli = path.join(root, "node_modules", "vinext", "dist", "cli.js");

function parseHostRule(value) {
  const candidate = String(value || "").trim();
  if (!candidate || /[\s/@?#]/.test(candidate)) return null;
  try {
    const parsed = new URL(`http://${candidate}`);
    if (parsed.pathname !== "/" || parsed.username || parsed.password) return null;
    return {
      hostname: parsed.hostname.toLowerCase().replace(/\.$/, ""),
      port: parsed.port,
    };
  } catch {
    return null;
  }
}

const allowedHostRules = [
  "127.0.0.1",
  "localhost",
  "[::1]",
  ...String(process.env.ALLOWED_HOSTS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
].map((value) => {
  const rule = parseHostRule(value);
  if (!rule) throw new Error(`ALLOWED_HOSTS contains an invalid host: ${value}`);
  return rule;
});

function isAllowedRequestHost(value) {
  const requestHost = parseHostRule(value);
  return Boolean(
    requestHost &&
      allowedHostRules.some(
        (allowed) =>
          allowed.hostname === requestHost.hostname &&
          (!allowed.port || allowed.port === requestHost.port),
      ),
  );
}

export const SECURITY_HEADERS = Object.freeze({
  "content-security-policy": [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
  ].join("; "),
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
});

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

if (!existsSync(tripPath) || !existsSync(packingPath)) {
  throw new Error("Generated private data is missing. Run `npm run regenerate` before starting the app.");
}

mkdirSync(dataDir, { recursive: true });
const referenceTrip = readJson(tripPath);
const referencePacking = readJson(packingPath);
const travelerNames = (referenceTrip.travelers || []).map(
  (traveler) => traveler.display_name,
);
const connectivitySlots = (referenceTrip.connectivity?.profiles || []).map(
  (profile) => profile.slot,
);
const pendingIds = new Set(
  (referenceTrip.pending_updates || []).map((update) => update.id),
);

const databasePath = path.join(dataDir, "travel-command-center-reference.sqlite");
const db = new DatabaseSync(databasePath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = FULL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS checklist_state (
    item_id TEXT PRIMARY KEY,
    checked INTEGER NOT NULL CHECK (checked IN (0, 1)),
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS esim_assignments (
    slot INTEGER PRIMARY KEY CHECK (slot BETWEEN 1 AND 4),
    person TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pending_values (
    update_id TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const selectChecks = db.prepare("SELECT item_id, checked FROM checklist_state ORDER BY item_id");
const selectAssignments = db.prepare("SELECT slot, person FROM esim_assignments ORDER BY slot");
const selectPending = db.prepare("SELECT update_id, value FROM pending_values ORDER BY update_id");
const upsertCheck = db.prepare(`
  INSERT INTO checklist_state (item_id, checked, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(item_id) DO UPDATE SET checked = excluded.checked, updated_at = excluded.updated_at
`);
const upsertAssignment = db.prepare(`
  INSERT INTO esim_assignments (slot, person, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(slot) DO UPDATE SET person = excluded.person, updated_at = excluded.updated_at
`);
const deleteAssignment = db.prepare("DELETE FROM esim_assignments WHERE slot = ?");
const upsertPending = db.prepare(`
  INSERT INTO pending_values (update_id, value, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(update_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(response, status, value) {
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 128_000) throw new RequestError(413, "Request body exceeds the 128 KB limit.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new RequestError(400, "Request body must contain valid JSON.");
  }
}

function validateMutationRequest(request) {
  const contentType = request.headers["content-type"] || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new RequestError(415, "Mutation requests must use application/json.");
  }
  const fetchSite = request.headers["sec-fetch-site"];
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    throw new RequestError(403, "Cross-site mutations are not allowed.");
  }
  const origin = request.headers.origin;
  if (origin) {
    let originHost;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      throw new RequestError(403, "Mutation origin is invalid.");
    }
    if (originHost !== String(request.headers.host || "").toLowerCase()) {
      throw new RequestError(403, "Cross-origin mutations are not allowed.");
    }
  }
}

function validId(value) {
  return typeof value === "string" && value.length > 2 && value.length <= 240 && /^[a-z0-9:_-]+$/i.test(value);
}

function validChecklistId(value) {
  return validId(value) && (value.startsWith("reference-packing:") || value.startsWith("prep:"));
}

function stateSnapshot() {
  const checks = Object.fromEntries(selectChecks.all().map((row) => [row.item_id, Boolean(row.checked)]));
  return {
    checks,
    hasChecklistState: Object.keys(checks).length > 0,
    assignments: Object.fromEntries(selectAssignments.all().map((row) => [String(row.slot), row.person])),
    pending: Object.fromEntries(selectPending.all().map((row) => [row.update_id, row.value])),
    syncedAt: new Date().toISOString(),
  };
}

const mutationRoutes = new Set([
  "/api/checklist",
  "/api/checklist/import",
  "/api/esim-assignment",
  "/api/pending",
]);

async function handleApi(request, response) {
  const url = new URL(request.url || "/", "http://internal.invalid");
  const shareSafe = url.searchParams.get("share") === "1";
  const isMutation = mutationRoutes.has(url.pathname) && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method || "");

  if (request.method === "GET" && url.pathname === "/api/health") {
    json(response, appStatus === "failed" ? 503 : 200, {
      status: appStatus === "failed" ? "unavailable" : "ok",
    });
    return;
  }

  if (shareSafe && isMutation) {
    json(response, 403, { error: "Share-safe mode is read-only." });
    return;
  }
  if (isMutation) validateMutationRequest(request);

  if (request.method === "GET" && url.pathname === "/api/state") {
    if (shareSafe) {
      json(response, 403, { error: "Private state is unavailable in share-safe mode." });
      return;
    }
    json(response, 200, stateSnapshot());
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/trip") {
    if (shareSafe) {
      json(response, 404, { error: "Share-safe trip data is embedded in the page." });
      return;
    }
    json(response, 200, referenceTrip);
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/packing") {
    if (shareSafe) {
      json(response, 404, { error: "Packing data is private." });
      return;
    }
    json(response, 200, referencePacking);
    return;
  }

  if (request.method === "PUT" && url.pathname === "/api/checklist") {
    const value = await body(request);
    if (!validChecklistId(value.id) || typeof value.checked !== "boolean") {
      json(response, 400, { error: "A valid stable item ID and checked value are required." });
      return;
    }
    const updatedAt = new Date().toISOString();
    upsertCheck.run(value.id, value.checked ? 1 : 0, updatedAt);
    json(response, 200, { id: value.id, checked: value.checked, updatedAt });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/checklist/import") {
    const value = await body(request);
    const existing = db.prepare("SELECT COUNT(*) AS total FROM checklist_state").get().total;
    if (existing > 0) {
      json(response, 200, { imported: 0, reason: "server-state-exists", ...stateSnapshot() });
      return;
    }
    const entries = Object.entries(value.checks || {}).filter(
      ([id, checked]) => validChecklistId(id) && typeof checked === "boolean",
    );
    db.exec("BEGIN IMMEDIATE");
    try {
      const updatedAt = new Date().toISOString();
      for (const [id, checked] of entries) upsertCheck.run(id, checked ? 1 : 0, updatedAt);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    json(response, 200, { imported: entries.length, ...stateSnapshot() });
    return;
  }

  if (request.method === "PUT" && url.pathname === "/api/esim-assignment") {
    const value = await body(request);
    const slot = Number(value.slot);
    if (!validDemoAssignment(slot, value.person, travelerNames, connectivitySlots)) {
      json(response, 400, { error: "A valid demonstration profile slot and traveler are required." });
      return;
    }
    const updatedAt = new Date().toISOString();
    if (value.person) upsertAssignment.run(slot, value.person, updatedAt);
    else deleteAssignment.run(slot);
    json(response, 200, { slot, person: value.person, updatedAt });
    return;
  }

  if (request.method === "PUT" && url.pathname === "/api/pending") {
    const value = await body(request);
    if (!pendingIds.has(value.id) || typeof value.value !== "string" || value.value.length > 5000) {
      json(response, 400, { error: "A valid pending-update ID and value are required." });
      return;
    }
    const updatedAt = new Date().toISOString();
    upsertPending.run(value.id, value.value, updatedAt);
    json(response, 200, { id: value.id, value: value.value, updatedAt });
    return;
  }

  json(response, 404, { error: "Not found" });
}

function normalizedDevelopmentPath(requestUrl) {
  let pathname;
  try {
    pathname = new URL(requestUrl || "/", "http://internal.invalid").pathname;
    for (let pass = 0; pass < 8; pass += 1) {
      const decoded = decodeURIComponent(pathname);
      if (decoded === pathname) break;
      pathname = decoded;
      if (pass === 7) return null;
    }
  } catch {
    return null;
  }
  pathname = pathname.replaceAll("\\", "/");
  if (pathname.includes("\0") || pathname.split("/").some((segment) => segment === "..")) {
    return null;
  }
  return pathname.toLowerCase();
}

function isBlockedDevelopmentPath(requestUrl) {
  if (!development) return false;
  const pathname = normalizedDevelopmentPath(requestUrl);
  if (!pathname) return true;
  const under = (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  return (
    under("/@fs") ||
    under("/data") ||
    under("/.local-state") ||
    (under("/app/data") && pathname !== "/app/data/trip-share.json") ||
    pathname === "/package-lock.json" ||
    pathname === "/server.mjs" ||
    pathname === "/.npmrc"
  );
}

let appStatus = "starting";
let appFailure = "";
let app;

function proxy(request, response) {
  if (appStatus === "failed") {
    response.writeHead(503, {
      ...SECURITY_HEADERS,
      "content-type": "text/plain; charset=utf-8",
      "retry-after": "2",
    });
    response.end(appFailure || "The application process is unavailable.");
    return;
  }

  const headers = { ...request.headers, host: `${appHost}:${appPort}` };
  delete headers["x-forwarded-for"];
  delete headers["x-forwarded-host"];
  delete headers["x-forwarded-proto"];
  const upstream = http.request(
    { hostname: appHost, port: appPort, path: request.url, method: request.method, headers },
    (upstreamResponse) => {
      appStatus = "running";
      response.writeHead(upstreamResponse.statusCode || 502, {
        ...upstreamResponse.headers,
        ...SECURITY_HEADERS,
      });
      upstreamResponse.pipe(response);
    },
  );
  upstream.on("error", () => {
    if (!response.headersSent) {
      response.writeHead(503, {
        ...SECURITY_HEADERS,
        "content-type": "text/plain; charset=utf-8",
        "retry-after": "2",
      });
    }
    response.end(appStatus === "failed" ? appFailure : "The application is starting. Please retry shortly.");
  });
  request.pipe(upstream);
}

const server = http.createServer(async (request, response) => {
  try {
    if (!isAllowedRequestHost(request.headers.host)) {
      json(response, 403, { error: "The request Host is not allowed." });
    } else if (isBlockedDevelopmentPath(request.url)) {
      response.writeHead(404, { ...SECURITY_HEADERS, "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    } else if (request.url?.startsWith("/api/")) await handleApi(request, response);
    else if (await serveStaticAsset(request, response, clientDirectory, SECURITY_HEADERS)) return;
    else proxy(request, response);
  } catch (error) {
    if (error instanceof RequestError) {
      json(response, error.status, { error: error.message });
    } else {
      console.error(error);
      if (!response.headersSent) json(response, 500, { error: "The private state could not be saved." });
      else response.end();
    }
  }
});

function startApplication() {
  if (!development && !existsSync(path.join(root, "dist", "server"))) {
    appStatus = "failed";
    appFailure = "The production build is missing. Run `npm run build` before starting the app.";
    return;
  }
  if (!existsSync(vinextCli)) {
    appStatus = "failed";
    appFailure = "Dependencies are missing. Run `npm install` before starting the app.";
    return;
  }
  app = spawn(
    process.execPath,
    [vinextCli, appCommand, "--hostname", appHost, "--port", String(appPort)],
    { cwd: root, env: { ...process.env, PORT: String(appPort) }, stdio: ["ignore", "inherit", "inherit"] },
  );
  app.on("exit", (code, signal) => {
    if (appStatus !== "stopping") {
      appStatus = "failed";
      appFailure = `The application process exited (${code ?? signal ?? "unknown"}).`;
      console.error(appFailure);
    }
  });
  app.on("error", (error) => {
    appStatus = "failed";
    appFailure = `The application process failed to start: ${error.message}`;
    console.error(appFailure);
  });
}

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Close the other process or set PORT to a free port.`);
  } else {
    console.error(`Server failed: ${error.message}`);
  }
  app?.kill("SIGTERM");
  db.close();
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`Family Travel Command Center listening at http://${host}:${port}; private state: ${databasePath}`);
  startApplication();
  if (appStatus === "failed") {
    console.error(appFailure);
    server.close(() => {
      db.close();
      process.exit(1);
    });
  }
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  appStatus = "stopping";
  app?.kill(signal);
  server.close(() => {
    try {
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      db.close();
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 8_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
