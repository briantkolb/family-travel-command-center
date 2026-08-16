import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
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
const appCommand = process.argv.includes("--dev") ? "dev" : "start";
const dataDir = process.env.DATA_DIR || path.join(root, ".local-state");
const clientDirectory = path.join(root, "dist", "client");
mkdirSync(dataDir, { recursive: true });
const referenceTrip = JSON.parse(
  readFileSync(path.join(root, "data", "northstar-isles-trip.json"), "utf8"),
);
const travelerNames = referenceTrip.travelers.map(
  (traveler) => traveler.display_name,
);
const connectivitySlots = referenceTrip.connectivity.profiles.map(
  (profile) => profile.slot,
);
const pendingIds = new Set(
  referenceTrip.pending_updates.map((update) => update.id),
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

const selectChecks = db.prepare(
  "SELECT item_id, checked, updated_at FROM checklist_state ORDER BY item_id",
);
const selectAssignments = db.prepare(
  "SELECT slot, person, updated_at FROM esim_assignments ORDER BY slot",
);
const selectPending = db.prepare(
  "SELECT update_id, value, updated_at FROM pending_values ORDER BY update_id",
);
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

function json(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 128_000) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function validId(value) {
  return typeof value === "string" && value.length > 2 && value.length <= 240 && /^[a-z0-9:_-]+$/i.test(value);
}

function validChecklistId(value) {
  return (
    validId(value) &&
    (value.startsWith("reference-packing:") || value.startsWith("prep:"))
  );
}

function stateSnapshot(shareSafe = false) {
  const checks = Object.fromEntries(
    selectChecks.all().map((row) => [row.item_id, Boolean(row.checked)]),
  );
  const assignments = Object.fromEntries(
    selectAssignments.all().map((row) => [String(row.slot), row.person]),
  );
  const pending = Object.fromEntries(
    selectPending.all().map((row) => [row.update_id, row.value]),
  );
  const snapshot = {
    checks,
    hasChecklistState: Object.keys(checks).length > 0,
    syncedAt: new Date().toISOString(),
  };
  if (!shareSafe) {
    snapshot.assignments = assignments;
    snapshot.pending = pending;
  }
  return snapshot;
}

async function handleApi(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const shareSafe = url.searchParams.get("share") === "1";
  if (request.method === "GET" && url.pathname === "/api/health") {
    json(response, 200, { status: "ok" });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/state") {
    json(response, 200, stateSnapshot(shareSafe));
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
      json(response, 200, { imported: 0, reason: "server-state-exists", ...stateSnapshot(shareSafe) });
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
    json(response, 200, { imported: entries.length, ...stateSnapshot(shareSafe) });
    return;
  }

  if (request.method === "PUT" && url.pathname === "/api/esim-assignment") {
    if (shareSafe) {
      json(response, 403, { error: "Assignments are unavailable in share-safe mode." });
      return;
    }
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
    if (shareSafe) {
      json(response, 403, { error: "Pending values are unavailable in share-safe mode." });
      return;
    }
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

function proxy(request, response) {
  const headers = { ...request.headers, host: request.headers.host };
  const upstream = http.request(
    {
      hostname: appHost,
      port: appPort,
      path: request.url,
      method: request.method,
      headers,
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );
  upstream.on("error", () => {
    if (!response.headersSent) {
      response.writeHead(503, { "content-type": "text/plain; charset=utf-8", "retry-after": "2" });
    }
    response.end("Reference app is starting. Please retry in a moment.");
  });
  request.pipe(upstream);
}

const vinextCli = path.join(root, "node_modules", "vinext", "dist", "cli.js");
const app = spawn(
  process.execPath,
  [vinextCli, appCommand, "--hostname", appHost, "--port", String(appPort)],
  {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(appPort),
  },
  stdio: ["ignore", "inherit", "inherit"],
  },
);

app.on("exit", (code, signal) => {
  console.error(`vinext ${appCommand} exited (${code ?? signal})`);
  process.exitCode = code || 1;
});
app.on("error", (error) => {
  console.error("Vinext production process failed to start", error);
  process.exitCode = 1;
  server.close();
});

const server = http.createServer(async (request, response) => {
  try {
    if (request.url?.startsWith("/api/")) await handleApi(request, response);
    else if (await serveStaticAsset(request, response, clientDirectory)) return;
    else proxy(request, response);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) json(response, 500, { error: "The shared state could not be saved." });
    else response.end();
  }
});

server.listen(port, host, () => {
  console.log(`Family Travel Command Center listening at http://${host}:${port}; state database: ${databasePath}`);
});

function shutdown(signal) {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  app.kill(signal);
  setTimeout(() => process.exit(1), 8_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
