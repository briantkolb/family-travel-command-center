# Family Travel Command Center

A field-tested family travel dashboard that brings an itinerary, transportation, lodging, activities, packing lists, accessibility preferences, pending details, and shared checklist state into one phone-friendly application.

The original application was built for and used during a real multi-country European family trip. This repository contains none of that family's private trip data. It has been replaced with **Northstar Isles**, a wholly fictional coastal journey designed to demonstrate the product safely.

## What it does

- Combines a daily itinerary with flights and ground transportation.
- Keeps lodging, vessel, excursion, and connectivity details together.
- Provides one packing list per traveler with searchable completion state.
- Synchronizes checklist, assignment, and pending-update state through a small local SQLite service.
- Works as an installable Progressive Web App (PWA) when served from a secure origin.
- Supports offline access to the application shell and queued checklist updates.
- Provides a share-safe view that structurally omits selected detail categories.

Northstar Isles, its travelers, providers, addresses, phone numbers, reservations, and schedules are invented. They are schema examples, not travel recommendations.

## Who this is for

This starter is for families and trip organizers who want a practical command center and are comfortable following copy-and-paste terminal instructions. You do not need to understand React, SQLite, Docker, or the internal build system to try it or update its data.

You do need:

- The ability to install Node.js and open a terminal.
- Basic care when editing JSON or Markdown—or an AI coding assistant that can edit them for you.
- A realistic privacy plan before entering real reservation or personal information.

## A. Five-minute demo

### Prerequisites

Install [Node.js](https://nodejs.org/) version **22.13 or newer**. Node includes `npm`.

Check your installation:

```text
node --version
npm --version
```

### Download and run

Download the repository ZIP from GitHub and extract it, or clone it:

```text
git clone https://github.com/briantkolb/family-travel-command-center.git
cd family-travel-command-center
npm install
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000) in a browser. Keep the terminal window open while using the app. Press `Ctrl+C` in that terminal to stop it.

You should see **Northstar Isles Coastal Circuit**, beginning with a large “Your whole trip” panel. Try the Itinerary and Packing tabs, check a packing item, reload the page, and confirm the item remains checked.

`npm run dev` regenerates the derived trip, packing, and icon files before starting, so a normal first run requires no separate build step.

## B. Make it yours

There are two canonical files to edit:

1. [`data/northstar-isles-trip.json`](data/northstar-isles-trip.json) contains travelers, dates, itinerary, transportation, lodging, activities, connectivity examples, accessibility preferences, pending fields, and other trip information.
2. [`data/northstar-isles-packing.md`](data/northstar-isles-packing.md) contains the traveler packing tables.

Despite their Northstar filenames, these remain the canonical source files after customization. Renaming them requires corresponding script changes and is not necessary.

Do **not** edit these generated files directly:

- `app/data/trip.json`
- `app/data/trip-share.json`
- `app/data/packing.json`
- Generated PNG icons in `public/`

The next regeneration would overwrite direct edits to those files.

### A small first customization

1. Stop the development server with `Ctrl+C`.
2. Open `data/northstar-isles-trip.json`.
3. Change `identity.trip_name` and `identity.hero_description`.
4. Change `identity.sample_data` from `true` to `false` when the file no longer represents the bundled fictional sample.
5. Save the file without removing commas, braces, brackets, or quotation marks.
6. Regenerate and verify:

```text
npm run regenerate
npm run test:browser:install
npm run check
npm run dev
```

Reload [http://127.0.0.1:3000](http://127.0.0.1:3000) and confirm the new trip name appears.

When replacing travelers, also update their headings in `data/northstar-isles-packing.md` and every traveler-name reference in seats, cabin assignments, accessibility preferences, and similar records. Changing a traveler name or packing item changes its stable checklist ID, so existing completion state for that entry will not carry over.

For a complete field-by-field walkthrough, read [Make It Yours](docs/MAKE_IT_YOURS.md).

## C. Use AI to build your trip

A capable AI coding assistant can inspect this repository and turn source material into the canonical schema. You can supply pasted itinerary text, exported emails, PDFs, screenshots, reservation confirmations, spreadsheets, or your own notes.

The assistant must treat Northstar Isles only as an example and must never guess a missing gate, address, date, confirmation number, traveler, or reservation detail. Unknown information should remain explicitly pending for human review.

Use the reusable [AI Trip Import Prompt](docs/AI_TRIP_IMPORT_PROMPT.md). It tells the assistant which files to edit, what not to invent, which sensitive values require special care, and which validation commands to run.

Before giving documents to any AI service, understand that service's data-handling policy and remove material it does not need. A repository is not a secure document vault.

## D. Take it on your phone

This project is a PWA. On supported phones, an installed PWA opens from the home screen and can retain the application shell for offline use.

- **On the same laptop:** `npm run dev` and `http://127.0.0.1:3000` are enough.
- **On a trusted private network:** expose the server on the LAN as described in [Deployment](docs/DEPLOYMENT.md). Ordinary browsing can work over HTTP, but phone PWA installation and service workers generally require HTTPS.
- **Hosted:** use the existing stateful Node/Docker architecture behind HTTPS. Static file hosting alone cannot preserve shared checklists, pending updates, assignments, or the SQLite state service.

The app has **no built-in authentication or encryption**. Hosting and access-control decisions matter much more once the sample data is replaced.

## E. Privacy and security

- The bundled Northstar Isles trip is fictional and safe as a public demo.
- The application currently has **no authentication or encryption**.
- Share-safe mode minimizes what the browser receives, but it is **not an authorization system**.
- Do not expose a full personal trip containing sensitive reservation data on an unrestricted public URL.
- Local laptop use or a trusted private network is appropriate for personal experimentation.
- Hosted use with real personal data requires an additional access-control layer in front of this application.
- Never commit real passwords, API keys, access tokens, private keys, tickets, QR payloads, activation codes, or highly sensitive medical or identity documents to a public repository.
- Confirmation numbers, addresses, phone numbers, room assignments, and detailed movements may also be sensitive even when they are not credentials.
- `data/northstar-isles-trip.json` is served by the private/full view. Treat it according to the most sensitive value you place inside it.

The share-safe view is available at `http://127.0.0.1:3000/?share=1`. It structurally omits selected reservation, lodging, contact, access, assignment, and pending-value categories. A person who can access the unrestricted server can still request the full view; share-safe mode does not replace authentication.

## F. Project structure

```text
app/                         React interface and generated browser data
data/                        Canonical trip JSON and packing Markdown to edit
docs/                        Customization, AI-import, and deployment guides
lib/                         Validation, redaction, and static-asset helpers
public/                      PWA manifest, service worker, and icons
scripts/                     Data generation, build, and validation commands
tests/                       Unit, API, production, browser, PWA, and privacy tests
server.mjs                   Node server and local SQLite state API
docker-compose.vps.yml       Advanced stateful Docker deployment example
Dockerfile                   Production container build
```

Runtime state is stored in `.local-state/` by default and is deliberately separate from canonical trip source data.

## G. Validation and testing

```text
npm run regenerate   Regenerate derived trip, share-safe, packing, and icon files
npm run lint         Check JavaScript, TypeScript, and React source
npm run typecheck    Run the TypeScript checker
npm run build        Create and validate a production build
npm run test:browser:install  Install Chromium once for browser tests
npm test             Build and run the complete automated test suite
npm run check        Run lint, typecheck, production build, and all tests
npm start            Run an already-built production application
```

Use `npm run check` before sharing changes. Run `npm run test:browser:install` once on a new machine before the complete test suite; the five-minute demo itself does not require this download.

## H. Architecture and advanced deployment

The application has two cooperating pieces:

1. A React/Vinext PWA interface.
2. A Node server that provides shared state through SQLite and starts the production application server.

That state server is why a simple static upload is not a faithful deployment of the current product. Docker is provided for reproducible hosting, but Docker, a VPS, a domain, and Cloudflare are not required for the five-minute local demo.

For the supported deployment levels, exact requirements, LAN commands, HTTPS notes, and the single recommended hosted pattern, see [Deployment](docs/DEPLOYMENT.md).

## Current limitations

- No user accounts, authentication, authorization, or encrypted application vault.
- No automated import of documents; use the AI-assisted workflow and review its output.
- No static-hosting mode that preserves shared mutable state.
- Connectivity assignments support up to four profile slots without a schema change.
