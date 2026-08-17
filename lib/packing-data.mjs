import { createHash } from "node:crypto";

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

export function buildPackingData(source, trip) {
  const people = trip.travelers.map(({ display_name: name }) => name);
  const output = {};

  for (const person of people) {
    const startMarker = `## ${person} —`;
    const start = source.indexOf(startMarker);
    if (start < 0) {
      const escapedPerson = person.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const wrongSeparator = new RegExp(
        `^##\\s+${escapedPerson}\\s+(?:-|–)\\s+`,
        "m",
      ).test(source);
      if (wrongSeparator) {
        throw new Error(
          `Packing heading for ${person} must use the literal em dash separator (—), not a hyphen (-) or en dash (–).`,
        );
      }
      throw new Error(`Missing packing section for ${person}`);
    }
    const nextStarts = people
      .map((candidate) =>
        source.indexOf(`## ${candidate} —`, start + startMarker.length),
      )
      .filter((index) => index > start);
    const end = nextStarts.length ? Math.min(...nextStarts) : source.length;
    const section = source.slice(start, end);
    const rows = [];

    for (const line of section.split(/\r?\n/)) {
      if (!/^\|\s*\d+\s*\|/.test(line)) continue;
      const cells = line.slice(1, -1).split(/(?<!\\)\|/).map(unescapeCell);
      if (cells.length !== 6) {
        throw new Error(
          `${person}: expected 6 table cells, received ${cells.length}: ${line}`,
        );
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

  if (
    Object.values(output)
      .flat()
      .some((row) => /DEMO-(?!ONLY)/.test(row.item))
  ) {
    throw new Error(
      "Packing item names must remain ordinary, non-credential content.",
    );
  }

  return output;
}
