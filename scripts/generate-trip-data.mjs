import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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

if (
  typeof trip.identity?.trip_name !== "string" ||
  !trip.identity.trip_name.trim()
) {
  throw new Error("The canonical trip must have a non-empty identity.trip_name.");
}
if (!Array.isArray(trip.travelers) || trip.travelers.length < 1) {
  throw new Error("The canonical trip must define at least one traveler.");
}
const travelerIds = trip.travelers.map((traveler) => traveler.id);
const travelerNames = trip.travelers.map((traveler) => traveler.display_name);
if (
  travelerIds.some((value) => typeof value !== "string" || !value.trim()) ||
  travelerNames.some((value) => typeof value !== "string" || !value.trim()) ||
  new Set(travelerIds).size !== travelerIds.length ||
  new Set(travelerNames).size !== travelerNames.length
) {
  throw new Error("Traveler IDs and display names must be non-empty and unique.");
}
if (!Array.isArray(trip.daily_plan) || trip.daily_plan.length < 1) {
  throw new Error("The canonical trip must define at least one daily-plan entry.");
}
const connectivitySlots = trip.connectivity?.profiles?.map(
  (profile) => profile.slot,
);
if (
  !Array.isArray(connectivitySlots) ||
  connectivitySlots.some(
    (slot) => !Number.isInteger(slot) || slot < 1 || slot > 4,
  ) ||
  new Set(connectivitySlots).size !== connectivitySlots.length
) {
  throw new Error("Connectivity profile slots must be unique integers from 1 to 4.");
}

await mkdir(path.dirname(outputPath), { recursive: true });
await Promise.all([
  writeFile(outputPath, `${JSON.stringify(trip, null, 2)}\n`),
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
