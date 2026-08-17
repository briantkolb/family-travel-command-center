import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateCanonicalTrip } from "../lib/canonical-trip.mjs";
import { buildPackingData } from "../lib/packing-data.mjs";

const root = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(root, "data", "northstar-isles-packing.md");
const tripPath = path.join(root, "data", "northstar-isles-trip.json");
const outputPath = path.join(root, "app", "data", "packing.json");

const source = await readFile(sourcePath, "utf8");
const trip = JSON.parse(await readFile(tripPath, "utf8"));
validateCanonicalTrip(trip);
const people = trip.travelers.map(({ display_name: name }) => name);
const output = buildPackingData(source, trip);

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(
  people.map((person) => `${person}=${output[person].length}`).join(" "),
);
