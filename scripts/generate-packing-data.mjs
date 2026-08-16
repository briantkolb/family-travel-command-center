import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(root, "data", "northstar-isles-packing.md");
const tripPath = path.join(root, "data", "northstar-isles-trip.json");
const outputPath = path.join(root, "app", "data", "packing.json");

function stableId(person, item) {
  const personId = person
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const digest = createHash("sha256")
    .update(`${person.toLowerCase()}\u0000${item}`)
    .digest("hex")
    .slice(0, 16);
  return `reference-packing:${personId}:${digest}`;
}

function unescapeCell(value) {
  return value
    .trim()
    .replaceAll("<br>", "\n")
    .replaceAll("\\|", "|")
    .replaceAll("&amp;", "&");
}

const source = await readFile(sourcePath, "utf8");
const trip = JSON.parse(await readFile(tripPath, "utf8"));
const people = trip.travelers.map(({ display_name: name }) => name);
const output = {};

for (const person of people) {
  const startMarker = `## ${person} —`;
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`Missing fictional packing section for ${person}`);
  const nextStarts = people
    .map((candidate) => source.indexOf(`## ${candidate} —`, start + startMarker.length))
    .filter((index) => index > start);
  const end = nextStarts.length ? Math.min(...nextStarts) : source.length;
  const section = source.slice(start, end);
  const rows = [];

  for (const line of section.split(/\r?\n/)) {
    if (!/^\|\s*\d+\s*\|/.test(line)) continue;
    const cells = line.slice(1, -1).split(/(?<!\\)\|/).map(unescapeCell);
    if (cells.length !== 6) {
      throw new Error(`${person}: expected 6 table cells, received ${cells.length}: ${line}`);
    }
    const [, category, item, packIn, when, notes] = cells;
    rows.push({
      id: stableId(person, item),
      person,
      category,
      item,
      packIn,
      when,
      notes,
    });
  }

  if (rows.length < 1) {
    throw new Error(`${person}: expected at least one packing row`);
  }
  if (new Set(rows.map((row) => row.id)).size !== rows.length) {
    throw new Error(`${person}: stable item ID collision`);
  }
  output[person] = rows;
}

if (Object.values(output).flat().some((row) => /DEMO-(?!ONLY)/.test(row.item))) {
  throw new Error("Packing item names must remain ordinary, non-credential content.");
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(
  people.map((person) => `${person}=${output[person].length}`).join(" "),
);
