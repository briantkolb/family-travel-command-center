import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { validDemoAssignment } from "../lib/reference-policy.mjs";
import { toShareSafeTrip } from "../lib/share-safe-trip.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFile(path.join(root, file), "utf8");

async function sourceFiles(directory) {
  return (await readdir(path.join(root, directory), { recursive: true }))
    .filter((name) => /\.(?:tsx?|mjs|js|json|css|md|webmanifest|ya?ml)$/.test(name))
    .map((name) => path.join(directory, name));
}

test("canonical trip is the generated application dataset", async () => {
  const canonical = JSON.parse(await read("data/northstar-isles-trip.json"));
  const generated = JSON.parse(await read("app/data/trip.json"));
  const shareSafe = JSON.parse(await read("app/data/trip-share.json"));
  assert.deepEqual(generated, canonical);
  assert.deepEqual(shareSafe, toShareSafeTrip(canonical));
  assert.ok(canonical.identity.trip_name.trim());
  assert.equal(typeof canonical.identity.sample_data, "boolean");
  assert.ok(canonical.travelers.length >= 1);
  assert.ok(canonical.daily_plan.length >= 1);
  assert.equal(
    new Set(canonical.travelers.map(({ id }) => id)).size,
    canonical.travelers.length,
  );
});

test("share-safe seed structurally omits private-detail categories", async () => {
  const shareSafe = JSON.parse(await read("app/data/trip-share.json"));
  const canonical = JSON.parse(await read("data/northstar-isles-trip.json"));
  const serialized = JSON.stringify(shareSafe);
  const excluded = [
    ...canonical.flights.flatMap((record) => [record.confirmation]),
    ...canonical.lodging.flatMap((record) => [
      record.confirmation,
      record.host_phone,
      record.wifi?.network,
    ]),
    ...canonical.cruise.staterooms.map((record) => record.reservation),
    ...canonical.ground_transport.flatMap((record) => [
      record.pnr,
      ...Object.values(record.boarding_codes || {}),
    ]),
  ].filter(Boolean);
  for (const value of excluded) {
    assert.equal(serialized.includes(value), false, value);
  }
  assert.deepEqual(shareSafe.lodging, []);
  assert.deepEqual(shareSafe.cruise.staterooms, []);
  assert.deepEqual(shareSafe.connectivity.profiles, []);
  assert.deepEqual(shareSafe.safety_accessibility.traveler_preferences, []);
  assert.deepEqual(shareSafe.pending_updates, []);
  assert.deepEqual(shareSafe.preparation_groups, {});
  assert.deepEqual(shareSafe.demo_vault_groups, []);
  for (const flight of shareSafe.flights) {
    assert.equal("confirmation" in flight, false);
    assert.equal("seats" in flight, false);
  }
});

test("packing is generated only for fictional travelers with new stable IDs", async () => {
  const trip = JSON.parse(await read("data/northstar-isles-trip.json"));
  const travelers = trip.travelers.map(({ display_name }) => display_name);
  const source = await read("data/northstar-isles-packing.md");
  const packing = JSON.parse(await read("app/data/packing.json"));
  assert.deepEqual(Object.keys(packing), travelers);
  for (const traveler of travelers) {
    assert.match(source, new RegExp(`## ${traveler.replace(" ", "\\s")}`));
    assert.ok(packing[traveler].length >= 1);
    for (const row of packing[traveler]) {
      assert.equal(row.person, traveler);
      assert.match(row.id, /^reference-packing:[a-z-]+:[a-f0-9]{16}$/);
    }
  }
});

test("state assignment policy accepts only canonical traveler identities", async () => {
  const trip = JSON.parse(await read("data/northstar-isles-trip.json"));
  const travelers = trip.travelers.map(({ display_name }) => display_name);
  const profileSlots = trip.connectivity.profiles.map(({ slot }) => slot);
  for (const [index, slot] of profileSlots.entries()) {
    assert.equal(
      validDemoAssignment(
        slot,
        travelers[index % travelers.length],
        travelers,
        profileSlots,
      ),
      true,
    );
  }
  if (profileSlots.length) {
    assert.equal(validDemoAssignment(profileSlots[0], "", travelers, profileSlots), true);
    assert.equal(
      validDemoAssignment(
        profileSlots[0],
        "Unlisted Traveler",
        travelers,
        profileSlots,
      ),
      false,
    );
  }
  assert.equal(validDemoAssignment(99, travelers[0], travelers, profileSlots), false);
});

test("sensitive features contain only generalized guidance and inert examples", async () => {
  const trip = JSON.parse(await read("data/northstar-isles-trip.json"));
  const travelers = trip.travelers.map(({ display_name }) => display_name);
  assert.ok(trip.safety_accessibility);
  assert.equal("health" in trip, false);
  assert.match(trip.safety_accessibility.public_emergency_guidance, /public emergency service/i);
  for (const profile of trip.safety_accessibility.traveler_preferences) {
    assert.ok(travelers.includes(profile.traveler));
    assert.ok(profile.items.length >= 2);
  }
  if (trip.identity.sample_data) {
    for (const group of trip.demo_vault_groups) {
      for (const item of group.items) {
        if (/booking|flight|rail|vessel|cabin/i.test(item.label)) {
          assert.match(item.value, /^DEMO-/);
        } else {
          assert.match(item.value, /DEMO(?: ONLY|-)/);
        }
      }
    }
    for (const record of trip.connectivity.profiles) {
      assert.match(record.demo_identifier, /^DEMO-/);
      assert.deepEqual(Object.keys(record).sort(), ["demo_identifier", "phone", "slot"]);
    }
  }
  assert.match(trip.connectivity.demo_notice, /No QR code, ICCID, activation token/i);
});

test("safe contacts and booking formats hold across canonical data", async () => {
  const trip = JSON.parse(await read("data/northstar-isles-trip.json"));
  if (!trip.identity.sample_data) return;
  const bookings = [
    ...trip.flights.map((record) => record.confirmation),
    ...trip.lodging.map((record) => record.confirmation),
    ...trip.cruise.staterooms.map((record) => record.reservation),
    ...trip.tours.flatMap((record) =>
      [record.booking_reference, record.confirmation].filter(Boolean),
    ),
  ];
  for (const value of bookings) assert.match(value, /^DEMO-/);
  for (const phone of [
    ...trip.lodging.map((record) => record.host_phone),
    ...trip.tours.map((record) => record.phone).filter(Boolean),
  ]) {
    assert.match(phone, /^\+1 202-555-01\d{2}$/);
  }
});

test("application identity and mutable namespaces use the reference boundary", async () => {
  const page = await read("app/page.tsx");
  const server = await read("server.mjs");
  const packageJson = JSON.parse(await read("package.json"));
  const compose = await read("docker-compose.vps.yml");
  assert.match(page, /travel-reference-state-v1/);
  assert.match(page, /travel-reference-queue-v1/);
  assert.match(page, /travel-reference-share-state-v1/);
  assert.match(page, /\.\/data\/trip-share\.json/);
  assert.doesNotMatch(page, /\.\/data\/trip\.json/);
  assert.doesNotMatch(
    await read("app/globals.css"),
    /\.share-mode\s+\.private-field/,
  );
  assert.match(page, /Safety & Accessibility/);
  assert.match(server, /travel-command-center-reference\.sqlite/);
  assert.match(server, /validDemoAssignment/);
  assert.equal(packageJson.name, "travel-command-center-reference");
  assert.match(compose, /container_name: travel-command-center-reference/);
});

test("PWA uses a neutral identity and only neutral icon references", async () => {
  const manifest = JSON.parse(await read("public/manifest.webmanifest"));
  assert.equal(manifest.name, "Family Travel Command Center");
  assert.equal(manifest.short_name, "Family Travel");
  assert.deepEqual(manifest.icons, [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/maskable-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ]);
  const serviceWorker = await read("public/sw.js");
  assert.match(serviceWorker, /travel-command-center-reference-/);
  assert.match(serviceWorker, /shell-v3/);
  assert.match(serviceWorker, /manifest\.webmanifest\?v=2/);
  assert.match(serviceWorker, /favicon\.svg/);
  assert.match(serviceWorker, /maskable-icon-512\.png/);
  assert.match(serviceWorker, /startsWith\(CACHE_PREFIX\)/);
});

test("ordinary workflows are portable and loopback-only by default", async () => {
  const packageJson = JSON.parse(await read("package.json"));
  for (const script of ["dev", "build", "start", "test", "lint", "typecheck"]) {
    assert.ok(packageJson.scripts[script], script);
    assert.doesNotMatch(packageJson.scripts[script], /\bbash\b|\bsh\b/);
  }
  const server = await read("server.mjs");
  const vite = await read("vite.config.ts");
  const compose = await read("docker-compose.vps.yml");
  assert.match(server, /process\.env\.HOST \|\| "127\.0\.0\.1"/);
  assert.match(server, /process\.env\.APP_INTERNAL_HOST \|\| "127\.0\.0\.1"/);
  assert.match(vite, /process\.env\.DEV_HOST \|\| "127\.0\.0\.1"/);
  assert.match(compose, /127\.0\.0\.1:3100:3000/);
  assert.match(compose, /HOST: 0\.0\.0\.0/);
  assert.match(compose, /travel-reference-state:\/data/);
  assert.match(compose, /api\/health/);
});

test("unused starter authentication and platform database scaffolding are absent", async () => {
  for (const removed of [
    ".openai/hosting.json",
    "app/chatgpt-auth.ts",
    "db/index.ts",
    "db/schema.ts",
    "drizzle.config.ts",
    "worker/index.ts",
    "build/sites-vite-plugin.ts",
    "examples/d1/app/api/notes/route.ts",
  ]) {
    await assert.rejects(access(path.join(root, removed)), { code: "ENOENT" });
  }
  const packageJson = JSON.parse(await read("package.json"));
  assert.equal(packageJson.dependencies["drizzle-orm"], undefined);
  assert.equal(packageJson.devDependencies["drizzle-kit"], undefined);
  assert.equal(packageJson.devDependencies["@cloudflare/vite-plugin"], undefined);
  assert.equal(packageJson.devDependencies.wrangler, undefined);
});

test("active application files do not embed forbidden credential shapes", async () => {
  const files = [
    ...(await sourceFiles("app")),
    ...(await sourceFiles("data")),
    ...(await sourceFiles("public")),
    "server.mjs",
    "package.json",
    "docker-compose.vps.yml",
    "Dockerfile",
  ];
  const credentialShape = /BEGIN (?:RSA |OPENSSH )?PRIVATE KEY|CLOUDFLARE_(?:TUNNEL_)?TOKEN|SSH_PRIVATE_KEY|\bICCID\s*[:=]\s*\d|\bQR\s*(?:payload|data)\s*[:=]/i;
  for (const file of files) assert.doesNotMatch(await read(file), credentialShape, file);
});
