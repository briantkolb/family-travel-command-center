# Family Travel Command Center Builder Data Contract

This is the authoritative, implementation-aligned contract for an AI Builder that prepares personal-trip files for Family Travel Command Center v1.2.1. The Builder proposes data; the traveler reviews and approves it; Start Here performs the authoritative local generation, build, and validation.

## Exact output files

Return two complete downloadable files with these exact names:

1. `northstar-isles-trip.json`
2. `northstar-isles-packing.md`

The filenames remain unchanged after replacing the fictional sample. The user puts both files in `data/` and runs Start Here.

## Required trip structure

The JSON root must be an object.

- `identity` is required. `identity.trip_name` is a non-empty string and `identity.sample_data` is `false` for a personal trip.
- `travelers` is a non-empty array. Every traveler has a non-empty, unique `id` and `display_name`.
- `daily_plan` is a non-empty array. Every day has a non-empty `date` and `place`.
- A day's `events` may be omitted or empty. When present, it is an array of two- or three-string rows: `[time, title]` or `[time, title, detail]`.
- A day's `tone` is optional. When present, it is a non-empty style name; omit it when no tone is needed.
- Optional section lists, when present, are arrays: `flights`, `ground_transport`, `lodging`, `tours`, `pending_updates`, and `demo_vault_groups`.
- Optional containers, when present, are objects: `airports`, `onward_steps`, `cruise`, `connectivity`, `safety_accessibility`, and `preparation_groups`. Every `airports` and `onward_steps` value must be a string.
- Every `demo_vault_groups` item must have meaningful, non-empty string `label` and `value` fields. Omit incomplete items; never use `undefined` as content.
- `cruise.staterooms`, `cruise.ports`, and `cruise.dining` may be omitted or empty arrays.
- `connectivity.profiles` and `connectivity.instructions` may be omitted or empty arrays. Profile slots, when used, are unique integers from 1 through 4.
- `safety_accessibility.traveler_preferences` and `general_guidance` may be omitted or empty arrays. A traveler may legitimately have only one approved operational preference.

Do not copy Northstar wording into a personal trip merely because the sample contains it.

## Unknown and optional values

Unknown information is valid. Prefer omitting an optional field. Use an empty array for a known-empty list, or `null` only for a supported scalar whose value is explicitly unknown. Use `pending_updates` for facts that need later confirmation.

Common optional fields include:

- Flight gates, terminals, duration, aircraft, fare, seats, confirmation, tickets, notes, and onward steps
- Ground-transport service, times, PNR, coach, seats, boarding references, fare, backup plans, and pending fields
- Lodging confirmation, guests, host, host phone, check-in/check-out time, instructions, access/Wi-Fi, luggage plans and addresses, and equipment notes
- Activity provider, contact, phone, time, duration, travelers, meeting point, map, booking reference, confirmation, payment, cancellation, and bring list
- Connectivity profiles, instructions, assignment text, notice, and vessel-connectivity note
- Emergency guidance, traveler preferences, general guidance, booking-reference groups, and preparation groups

If a phone number is unavailable, omit it; the app will omit Call and WhatsApp actions. If a list is unavailable, omit it or use `[]`. Never invent a placeholder person, address, booking, contact, equipment note, or instruction to make a screen render.

## Facts that must never be invented

Do not invent traveler identities, dates, local times, flight or train numbers, terminals, gates, addresses, hosts, phone numbers, meeting points, reservation status, confirmation numbers, access instructions, prices, or medical facts. Label a recommendation as a recommendation and a pending fact as pending.

## Privacy exclusions

Do not put these in either canonical file:

- Passwords, private access codes, API keys, session tokens, or private keys
- Passport or identity-document values
- Ticket barcodes, QR payloads, eSIM activation strings, or ICCIDs
- Payment-card or banking data
- Detailed medical records, medication lists, or insurance identifiers

The private app is browser-delivered and is not an encrypted vault.

## Exact ShareTripV1 boundary

Sharing is a separate, human-approved proposal under the top-level `sharing` key. Unknown fields invalidate the entire profile and make share mode fail closed.

`sharing` must contain exactly:

- `schema_version` equal to `1`
- `identity` with exactly `application_name`, `short_name`, `share_title`, `date_label`, and `summary`
- `days` rows with exactly `date`, `place_label`, and `summary`
- `transport` rows with exactly `date`, `route_label`, `service_label`, and `status`
- `ports` rows with exactly `date` and `port`
- `tours` rows with exactly `date`, `name`, and `status`

Every permitted leaf except `schema_version` is a string. Packing, traveler names, lodging, exact transport times or numbers, bookings, contacts, addresses, dining, accessibility, preparation, private state, and all unknown/future fields are excluded. The Builder must show the proposed ShareTripV1 separately and obtain explicit approval before final output.

## Packing Markdown

Create one section per traveler using the exact `display_name`:

```text
## Traveler Name — Role

| # | Category | Item | Pack in | When | Notes |
|---|---|---|---|---|---|
| 1 | Planning | Trip documents | Day bag | Before departure | Review before travel. |
```

The heading separator is the literal em dash character (`—`). A hyphen (`-`) or en dash (`–`) is not accepted.

Every traveler needs at least one numbered row and every row needs all six cells. Escape a literal pipe as `\|`; use `<br>` for a deliberate line break inside a cell.

Extracted reservation facts remain evidence-based. After reconciliation, the Builder may run a separate recommendation phase for ordinary packing and preparation items based on trip duration, destinations, transportation, activities, weather expectations, and user preferences. Present these as recommendations—not extracted facts—and require the user to approve or edit them before generating the final Markdown. Sensitive medical and identity information remains excluded.

## Privacy validation canary

Do not create or preserve `identity.private_validation_canary`. Start Here injects a fixed tooling-only canary into the generated private dataset. Tests verify that this canary never appears in the share payload or built client assets, regardless of what personal trip replaced the sample.

## Builder checks versus local checks

The Builder may check JSON syntax, the required structure above, unique traveler identities, exact ShareTripV1 keys, packing headings, six-cell rows, evidence provenance, and the explicit approval record.

The Builder must not claim that the app passed local validation. Start Here and the repository tools remain authoritative for canonical generation, packing generation, privacy-canary injection, ShareTripV1 acceptance/fail-closed diagnostics, the production build, browser privacy behavior, offline behavior, and the complete automated suite.
