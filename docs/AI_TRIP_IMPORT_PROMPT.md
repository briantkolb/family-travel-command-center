# AI Trip Import Prompt

Copy the prompt below into ChatGPT, Codex, Claude, or another capable coding assistant that can access this repository. Attach or paste only the source material you are comfortable sharing with that service.

## Copy/paste prompt

```text
You are helping me customize this Family Travel Command Center repository for a real trip.

Work only inside the repository copy I provide. Do not publish, deploy, initialize Git, commit, push, or contact any traveler or provider.

First inspect the repository schema and instructions, especially:
- README.md
- docs/MAKE_IT_YOURS.md
- data/northstar-isles-trip.json
- data/northstar-isles-packing.md
- scripts/generate-trip-data.mjs
- scripts/generate-packing-data.mjs
- lib/share-safe-trip.mjs

Treat Northstar Isles and every bundled traveler, provider, destination, schedule, phone number, address, and DEMO identifier as fictional schema/example data. Do not mix Northstar facts into my trip.

My source material may include pasted emails, PDFs, screenshots, reservation confirmations, spreadsheets, notes, exported itinerary documents, and manually gathered details. Inspect all supplied material carefully and build an evidence-based structured inventory before editing.

Extract and reconcile, where supported by the repository:
- Trip title, start/end dates, and displayed date label
- Travelers and their exact names
- Destinations and daily itinerary entries
- Flights, including route, operating carrier, flight number, local dates/times, terminals, and stated gate snapshots
- Rail, ferries, shuttles, transfers, rental transport, and other segments
- Lodging names, addresses, check-in/out times, contacts, and useful instructions
- Cruise or vessel schedule, cabins, ports, and dining where applicable
- Excursions, activities, reservations, meeting points, duration, and important instructions
- Confirmation/reference numbers that are appropriate for this application's full view
- Cancellation, check-in, boarding, luggage, accessibility, pacing, safety, and contingency notes
- Packing items by traveler
- Unknown or pending details that require human follow-up

Date and time rules:
- Normalize dates as YYYY-MM-DD.
- Normalize supported local date-times as YYYY-MM-DDTHH:MM:SS.
- Treat displayed trip times as local to the event location unless the source explicitly says otherwise.
- Preserve an explicitly supplied timezone in a note if the current schema has no dedicated timezone field.
- Check overnight travel, date-line changes, and arrival dates carefully.
- Do not silently convert a local time to another timezone.

Evidence and uncertainty rules:
- NEVER fabricate, infer, or autocomplete missing reservation information.
- Never invent a confirmation number, address, gate, terminal, seat, traveler, provider, meeting point, date, time, or price.
- Distinguish confirmed facts from estimates, suggestions, and stale snapshots.
- If sources conflict, do not choose silently. Record the conflict for human review.
- Use an explicit pending_updates entry or a clearly worded pending note for unknown supported information.
- Preserve useful provider wording for cancellation, check-in, boarding, meeting, and return instructions without claiming it is current if the source is old.

Security rules:
- Do not place passwords, API keys, private keys, access tokens, session cookies, authentication secrets, full payment-card data, eSIM activation strings, ICCIDs, ticket barcode data, or QR payloads into browser-delivered data.
- Do not extract hidden QR/barcode payloads into source files.
- Flag highly sensitive identity, medical, or access information for separate handling instead of adding it automatically.
- Treat confirmation numbers, addresses, phone numbers, room assignments, and precise movements as potentially sensitive.
- Remember that this application has no built-in authentication or encryption and that share-safe mode is not authorization.
- If the intended hosting/privacy model is unclear, stop before importing sensitive values and ask me to choose local/private use or protected hosting.

Editing rules:
- Edit canonical data/northstar-isles-trip.json and data/northstar-isles-packing.md.
- Do not directly edit app/data/trip.json, app/data/trip-share.json, or app/data/packing.json.
- Set identity.sample_data to false for my real trip.
- Preserve the existing schema and application behavior unless a source requirement cannot be represented. Report unsupported information instead of redesigning the app.
- Keep traveler display names consistent across the trip JSON and packing Markdown headings.
- Keep IDs lowercase, stable, unique, and hyphenated where the existing schema expects IDs.

Before editing, give me:
1. A concise inventory of source documents reviewed.
2. The travelers and trip span you identified.
3. A proposed transportation/lodging/activity outline.
4. A list of conflicts, unknowns, and sensitive values that need my decision.

After I approve that inventory, make the canonical-data edits and run:
- npm run regenerate
- npm run lint
- npm run typecheck
- npm run test:browser:install (once if Chromium is not already installed)
- npm test
- npm run build if it was not already run by the test command

Then inspect the normal and ?share=1 browser-delivered results where practical.

Finish with:
- Exact files changed
- Travelers, dates, destinations, transport, lodging, and activities imported
- Confirmation/reference categories included
- Sensitive values deliberately excluded
- Every unresolved, conflicting, estimated, or stale detail
- Regeneration, lint, typecheck, test, build, and runtime results
- A reminder that I must compare the result with original provider records before relying on it
```

## Human-review checklist

Before accepting an AI-generated trip:

- [ ] Every traveler is real, intended, and spelled exactly as required.
- [ ] No Northstar Isles traveler, provider, location, or `DEMO-*` value remains accidentally.
- [ ] Dates and local times match authoritative documents.
- [ ] Overnight arrivals and timezone/date changes are correct.
- [ ] Every transport segment connects logically to the next.
- [ ] Lodging dates cover the intended nights without gaps or overlaps.
- [ ] Meeting points and check-in instructions came from supplied evidence.
- [ ] Confirmation values were copied exactly and are appropriate for this privacy model.
- [ ] Unknown values are visibly pending; none were guessed.
- [ ] Cancellation and safety notes have not been presented as current without verification.
- [ ] No password, token, QR payload, ticket barcode, private key, or eSIM activation secret was added.
- [ ] Highly sensitive health and identity data remains outside this browser-delivered application.
- [ ] Packing headings exactly match traveler display names.
- [ ] `identity.sample_data` is `false`.
- [ ] `npm run check` passes.
- [ ] Both the full view and `?share=1` view were inspected.
- [ ] The final result was compared against original airline, lodging, operator, and reservation records.
