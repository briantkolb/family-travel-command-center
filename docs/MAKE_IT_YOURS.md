# Make It Yours

This guide takes you from the fictional Northstar Isles sample to your own family trip. You can make these changes yourself or ask an AI coding assistant to perform them while you review the result.

## Before you begin

Install Node.js 22.13 or newer, download the repository, and run:

```text
npm install
npm run regenerate
npm run build:prepared
npm start
```

Open `http://127.0.0.1:3000` and confirm Northstar Isles works before editing anything. Stop the server with `Ctrl+C`.

Make a private backup of your source material. Do not put real trip documents or credentials in a public repository.

## Know which files to edit

Edit only these canonical data sources for an ordinary trip customization:

- `data/northstar-isles-trip.json` — trip identity, travelers, itinerary, reservations, and operational details
- `data/northstar-isles-packing.md` — traveler packing lists

Do not edit these generated outputs:

- `app/data/trip.json`
- `app/data/trip-share.json`
- `app/data/packing.json`
- Generated PNG icons under `public/`

Run `npm run regenerate` after changing canonical data. Generation overwrites the derived files.

## JSON basics

The trip file uses JSON:

- Text must be inside double quotation marks.
- Entries are separated by commas.
- Objects use `{ }`; lists use `[ ]`.
- JSON has no comments.
- Dates use `YYYY-MM-DD`.
- Local date-times use `YYYY-MM-DDTHH:MM:SS` and represent the local time at that trip location.
- Use `null` for a deliberately unknown supported value; do not invent one.

If an edit causes a syntax error, an AI assistant or a JSON-aware editor can usually identify the missing comma or bracket.

## 1. Trip identity and dates

At the top of `data/northstar-isles-trip.json`, update `identity`:

```json
{
  "sample_data": false,
  "trip_name": "Our Coastal Reunion",
  "trip_dates": {
    "start": "2028-06-14",
    "end": "2028-06-21",
    "label": "June 14–21, 2028"
  }
}
```

Keep `application_name` and `short_name` generic unless you intentionally want to rebrand the application. Set `sample_data` to `false` once the canonical file contains your own information.

## 1A. Explicit share-safe profile

The top-level `sharing` object is separate from private `identity` and itinerary data. Review every leaf as if it will be shown to every share-link recipient. It must exactly follow [`SHARE_SAFE.md`](SHARE_SAFE.md).

Do not copy entire private records into `sharing`. If you are not ready to approve a share profile, remove it or leave it invalid: generation then fails closed to “No details approved for sharing.” Setting `identity.sample_data` to `false` does not relax this validator.

## 2. Travelers

Replace the entries in `travelers`. Each traveler needs:

- A unique lowercase `id`, normally words separated by hyphens
- A `display_name`
- A short `role`

Use the exact same display name everywhere that traveler appears: flight seats, rail seats, vessel rooms, accessibility preferences, connectivity assignments, and packing headings.

Also rename the matching Markdown heading in `data/northstar-isles-packing.md`:

```text
## Traveler Name — Trip role
```

Changing a traveler name or packing item creates a new stable checklist ID. Previous completion state for that item will not transfer automatically.

## 3. Destinations and daily plan

Update:

- `airports` for airport or station codes and display names
- `onward_steps` for the next action after a flight
- `daily_plan` for each day's place, events, and “what to know” note

Each daily event is a three-part list:

```json
["9:30 AM", "Museum visit", "Meet at the public entrance after breakfast."]
```

Keep events in chronological order. Use an explicit phrase such as `Pending human confirmation` when the time or meeting point is unknown.

## 4. Flights

Each `flights` entry can describe:

- Date and route
- Flight number and operating airline
- Local departure and arrival time
- Terminals and last-known gate snapshots
- Duration, aircraft, fare, and seats
- Confirmation/reference value
- Notes and onward steps

Gate and terminal values change frequently. Mark snapshots as provisional and verify them with the airline. Never ask an AI to guess them.

Daily-plan entries reference flights by their zero-based position in the `flights` list. For example, `"flights": [0]` displays the first flight. Reordering flights may require updating these indexes.

## 5. Rail and other transportation

Use `ground_transport` for rail, shuttles, ferries, transfers, and other segments. Northstar shows several flexible record shapes:

- A primary and backup transfer plan
- A scheduled rail service with seats and boarding references
- A weather-dependent ferry plan
- A pending return transfer

Retain only fields that apply. Preserve important boarding, luggage, timing, and contingency notes. Do not turn an estimate into a confirmed reservation.

## 6. Lodging

For every `lodging` entry, review:

- City and display name
- Address and map destination
- Confirmation value
- Guests and host/contact details
- Check-in and check-out times
- Check-in and checkout instructions
- Luggage options
- Power/equipment notes
- Access and Wi-Fi fields

Access codes and Wi-Fi passwords are browser-delivered in the full view. This project is not an encrypted vault. Prefer leaving highly sensitive access credentials out and retrieving them from the original provider when needed.

## 7. Cruise or vessel information

The `cruise` object supports:

- Vessel identity and dates
- Embarkation details
- Staterooms and assigned travelers
- Port arrival/departure schedule
- Dining reservations
- Safety reminders

If your trip has no vessel component, keep the object structurally valid with empty `staterooms`, `ports`, and `dining` lists, and use a neutral “Not part of this trip” label. Removing the object entirely currently requires interface changes.

## 8. Excursions and activities

Use `tours` for booked or self-guided activities. Review:

- Date, name, type, and status
- Provider and contact
- Time and duration
- Travelers or party size
- Meeting point and map address
- Booking and confirmation values
- Cancellation, safety, and “bring” notes

Use `no_reservation_required` for a self-guided activity. Unknown meeting points belong in `pending_updates`, not in an invented address.

## 9. Connectivity

`connectivity` demonstrates eSIM assignment and related instructions. The current SQLite schema supports unique profile slots numbered 1 through 4.

Do not store a real QR payload, ICCID, activation token, account password, or carrier credential in the repository. Use harmless labels and keep the original activation material in the carrier's protected system.

If you do not need this feature, use an empty `profiles` list and update the explanatory text.

## 10. Accessibility and preferences

Use `safety_accessibility.traveler_preferences` for operational preferences such as:

- Step-free routes
- Extra wayfinding time
- Flexible pacing
- Planned seated breaks

Avoid storing diagnoses, medication lists, insurance identifiers, or detailed medical history in browser-delivered data. Keep emergency guidance general and verify real advice with authoritative sources.

## 11. Pending details

Use `pending_updates` when a real detail is not known yet. Each entry needs a unique `id`, a plain-language `text`, and a `due` description.

This is better than inserting a plausible but unverified value. The running app can store the confirmed value later in its local SQLite state.

## 12. Confirmation and reference information

Confirmation numbers are not passwords, but they can still reveal travel arrangements. Before including one, decide whether the full app will remain local/private or be protected by access control.

Never put these into the canonical data:

- Passwords or private access tokens
- API keys or private keys
- Ticket barcodes or QR payloads
- eSIM activation strings
- Session cookies
- Full payment-card data
- Highly sensitive identity or medical documents

The share-safe view contains only the explicitly reviewed ShareTripV1 leaves and is read-only, but it does not prevent someone with unrestricted server access from opening the full view.

## 13. Packing lists

`data/northstar-isles-packing.md` contains one six-column table per traveler:

```text
| # | Category | Item | Pack in | When | Notes |
| 1 | Documents | Route overview | Day bag | Day before | Verify the latest version. |
```

Keep the heading's traveler name identical to `display_name` in the trip JSON. Each traveler needs at least one numbered row. The generator creates stable IDs from the traveler and item names.

## 14. Regenerate and validate

From the repository folder:

```text
npm run regenerate
npm run test:browser:install
npm run check
```

Then run:

```text
npm run dev
```

`npm run dev` is a loopback-only developer convenience. Never bind it to a LAN or hosted interface with real trip data. For ordinary or network use, run Start Here or `npm run build && npm start`.

Open `http://127.0.0.1:3000` and inspect every relevant tab. Also use a fresh browser context to open `http://127.0.0.1:3000/?share=1` directly and confirm that its explicitly approved view matches your expectations.

## Human review before travel

- Compare every date and local time with the original provider.
- Verify traveler names exactly match reservations and travel documents.
- Confirm flight, rail, ferry, and vessel sequence.
- Check lodging addresses and check-in instructions.
- Verify activity meeting points, cancellation terms, and return timing.
- Resolve or clearly retain every unknown field.
- Confirm no forbidden secret material entered the repository.
- Test on the actual phones and network you plan to use.
- Keep authoritative tickets and provider applications available separately.
