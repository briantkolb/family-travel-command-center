# Put Your Two Personal-Trip Files Here

This folder is the handoff point between an ordinary AI chat and Family Travel Command Center. You do not need a coding agent to use it.

Replace these two bundled sample files with the complete files prepared for your trip:

1. `northstar-isles-trip.json` — the canonical trip, travelers, dates, itinerary, transportation, lodging, activities, and supported operational details
2. `northstar-isles-packing.md` — the canonical packing tables for those same travelers

The filenames stay the same even after Northstar Isles has been replaced. The launchers and generators use these exact paths.

## Simple workflow

1. Open [`docs/AI_TRIP_IMPORT_PROMPT.md`](../docs/AI_TRIP_IMPORT_PROMPT.md).
2. In ChatGPT or another capable LLM, provide that prompt, the two current sample files, and only the trip source material you are comfortable sharing with that service.
3. Ask it to return two **complete downloadable replacement files** with the exact filenames above. Do not accept partial snippets.
4. Review the files carefully. Confirm traveler names, dates, local times, reservations, unknown details, the privacy checklist, and every leaf in the trip JSON's top-level `sharing` profile.
5. Put the downloaded files in this `data` folder and approve replacing the existing sample files.
6. Run `START-HERE-WINDOWS.cmd` on Windows, or run `sh START-HERE-MAC-LINUX.sh` in Terminal on macOS/Linux.

Start Here regenerates the derived application files, creates a private production build, and opens the app at `http://127.0.0.1:3000`.

Do not edit `app/data/trip.json`, `app/data/trip-share.json`, or `app/data/packing.json` directly. They are generated from the two canonical files in this folder and will be overwritten.

## Privacy reminder

The launchers run locally, bind only to `127.0.0.1`, and do not deploy or publish your trip. The app has no built-in authentication or encryption. Do not place passwords, access tokens, QR payloads, ticket barcodes, payment-card data, or highly sensitive identity or medical records in these files.

The share-safe route fails closed. It reads only the exact top-level `sharing` profile described in [`docs/SHARE_SAFE.md`](../docs/SHARE_SAFE.md); it never falls back to private itinerary fields. A missing, malformed, or future/unknown sharing field produces a minimal “No details approved for sharing” page. Packing is always private.

For phone, network, or hosted access, stop here and read [`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md) before making any server reachable from another device.
