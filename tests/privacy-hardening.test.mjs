import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { PRIVATE_BUILD_VALIDATION_CANARY } from "../lib/canonical-trip.mjs";
import {
  isShareTripV1,
  shareTripV1Keys,
  toShareSafeTrip,
} from "../lib/share-safe-trip.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFile(path.join(root, file), "utf8");
const readJson = async (file) => JSON.parse(await read(file));

function recursivelyInjectCanaries(value, pathParts = [], includeSharing = false) {
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      recursivelyInjectCanaries(item, [...pathParts, String(index)], includeSharing),
    );
  }
  if (value && typeof value === "object") {
    if (!includeSharing && pathParts[0] === "sharing") return structuredClone(value);
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = recursivelyInjectCanaries(child, [...pathParts, key], includeSharing);
    }
    result[`secret_canary_${pathParts.join("_") || "root"}`] =
      `SECRET_CANARY_INJECTED_${pathParts.join("_") || "ROOT"}`;
    return result;
  }
  return value;
}

function assertExactContract(value) {
  assert.equal(isShareTripV1(value), true);
  assert.deepEqual(Object.keys(value).sort(), [...shareTripV1Keys.root].sort());
  assert.deepEqual(Object.keys(value.identity).sort(), [...shareTripV1Keys.identity].sort());
  for (const item of value.days) {
    assert.deepEqual(Object.keys(item).sort(), [...shareTripV1Keys.day].sort());
  }
  for (const item of value.transport) {
    assert.deepEqual(Object.keys(item).sort(), [...shareTripV1Keys.transport].sort());
  }
  for (const item of value.ports) {
    assert.deepEqual(Object.keys(item).sort(), [...shareTripV1Keys.port].sort());
  }
  for (const item of value.tours) {
    assert.deepEqual(Object.keys(item).sort(), [...shareTripV1Keys.tour].sort());
  }
}

test("ShareTripV1 excludes recursively injected private and future fields", async () => {
  const sample = await readJson("tests/fixtures/sample-trip.json");
  const baseline = toShareSafeTrip(sample);
  const injected = recursivelyInjectCanaries(sample);
  const result = toShareSafeTrip(injected);
  assert.deepEqual(result, baseline);
  assertExactContract(result);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_CANARY/i);
});

test("unknown sharing fields invalidate the whole profile and fail closed", async () => {
  const sample = await readJson("tests/fixtures/sample-trip.json");
  const injected = recursivelyInjectCanaries(sample, [], true);
  const result = toShareSafeTrip(injected);
  assertExactContract(result);
  assert.equal(result.identity.summary, "No details approved for sharing.");
  assert.deepEqual(result.days, []);
  assert.deepEqual(result.transport, []);
  assert.deepEqual(result.ports, []);
  assert.deepEqual(result.tours, []);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_CANARY/i);
});

test("real-data mode uses the same strict privacy validation", async () => {
  const fixture = await readJson("tests/fixtures/real-data-mode-trip.json");
  assert.equal(fixture.identity.sample_data, false);
  const result = toShareSafeTrip(fixture);
  assertExactContract(result);
  assert.equal(result.identity.share_title, "Reviewed real-data-mode overview");
  assert.doesNotMatch(JSON.stringify(result), /SECRET_CANARY|booking|packing|passport/i);

  const invalid = structuredClone(fixture);
  invalid.sharing.future_ai_field = "SECRET_CANARY_REAL_SHARING";
  const failedClosed = toShareSafeTrip(invalid);
  assert.equal(failedClosed.identity.summary, "No details approved for sharing.");
  assert.doesNotMatch(JSON.stringify(failedClosed), /SECRET_CANARY/i);
});

test("generated share JSON and built client assets contain no private canaries", async () => {
  const shareJson = await read("app/data/trip-share.json");
  assert.doesNotMatch(shareJson, /SECRET_CANARY/i);

  const clientRoot = path.join(root, "dist", "client");
  const files = await readdir(clientRoot, { recursive: true });
  const searchable = files.filter((file) => /\.(?:html|js|json|css)$/i.test(file));
  const delivered = (
    await Promise.all(searchable.map((file) => readFile(path.join(clientRoot, file), "utf8")))
  ).join("\n");
  assert.doesNotMatch(delivered, new RegExp(PRIVATE_BUILD_VALIDATION_CANARY));
});

test("dependency notices and minimal non-root production runtime remain visible", async () => {
  const npmrc = await read(".npmrc");
  const packageJson = await readJson("package.json");
  const dockerfile = await read("Dockerfile");
  assert.doesNotMatch(npmrc, /^audit=false$/m);
  assert.equal(packageJson.version, "1.2.1");
  assert.equal(packageJson.dependencies.vinext, "0.0.50");
  assert.match(dockerfile, /COPY runtime\/package\.json runtime\/package-lock\.json/);
  assert.match(dockerfile, /RUN npm ci && npm cache clean --force/);
  const runtimePackage = await readJson("runtime/package.json");
  assert.equal(runtimePackage.type, "module");
  assert.deepEqual(Object.keys(runtimePackage.dependencies).sort(), [
    "@vitejs/plugin-react",
    "@vitejs/plugin-rsc",
    "react",
    "react-dom",
    "react-server-dom-webpack",
    "vinext",
    "vite",
  ]);
  assert.equal(runtimePackage.devDependencies, undefined);
  assert.equal(runtimePackage.dependencies.next, undefined);
  assert.equal(runtimePackage.dependencies["@playwright/test"], undefined);
  assert.equal(runtimePackage.dependencies.typescript, undefined);
  assert.equal(runtimePackage.dependencies.sharp, undefined);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /CMD \["node", "server\.mjs"\]/);
  assert.doesNotMatch(dockerfile, /COPY --from=builder \/app \.\//);
});
