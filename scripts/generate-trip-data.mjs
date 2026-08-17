import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  validateCanonicalTrip,
  withPrivateBuildValidationCanary,
} from "../lib/canonical-trip.mjs";
import {
  diagnoseShareProfile,
  formatShareProfileDiagnostic,
  toShareSafeTrip,
} from "../lib/share-safe-trip.mjs";

const root = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(root, "data", "northstar-isles-trip.json");
const outputPath = path.join(root, "app", "data", "trip.json");
const shareSafeOutputPath = path.join(root, "app", "data", "trip-share.json");

const trip = JSON.parse(await readFile(sourcePath, "utf8"));
validateCanonicalTrip(trip);
const privateTrip = withPrivateBuildValidationCanary(trip);

await mkdir(path.dirname(outputPath), { recursive: true });
await Promise.all([
  writeFile(outputPath, `${JSON.stringify(privateTrip, null, 2)}\n`),
  writeFile(
    shareSafeOutputPath,
    `${JSON.stringify(toShareSafeTrip(trip), null, 2)}\n`,
  ),
]);
console.log(`trip=${trip.identity.trip_name} travelers=${trip.travelers.length}`);
const sharingDiagnostic = diagnoseShareProfile(trip);
const sharingMessage = formatShareProfileDiagnostic(trip);
if (sharingDiagnostic.status === "invalid") console.warn(sharingMessage);
else console.log(sharingMessage);
