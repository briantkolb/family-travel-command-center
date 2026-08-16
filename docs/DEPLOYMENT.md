# Deployment and Access Models

Start locally before considering hosting. The application is a stateful Node service, not just a folder of static HTML files.

## What the architecture requires

The production application uses:

- A React/Vinext web application
- `server.mjs` as the public HTTP and state API server
- A local SQLite database for checklist, connectivity-assignment, and pending-update state
- A persistent writable data directory
- A service worker for PWA/offline-shell behavior

Static hosting cannot faithfully preserve shared mutable state or the existing API. Converting this into a static-only app would change the product and is outside the current starter workflow.

## A. Local laptop use

Requirements:

- Node.js 22.13 or newer
- npm dependencies

Commands:

```text
npm install
npm run dev
```

Open `http://127.0.0.1:3000`.

Not required: Docker, VPS, domain, Cloudflare, or authentication. The server listens only on loopback by default.

## B. Trusted local/private-network use

This lets another device on the same trusted LAN reach the development server.

PowerShell:

```powershell
$env:HOST="0.0.0.0"
npm run dev
```

macOS/Linux:

```sh
HOST=0.0.0.0 npm run dev
```

Open `http://<laptop-lan-address>:3000` on the other device. Your operating-system firewall may ask for permission.

Important limitations:

- Anyone who can reach that port can reach the full application and state API.
- Use this only on a network and devices you trust.
- Browsing may work over LAN HTTP, but service workers and installable PWA behavior generally require HTTPS except on localhost.
- Do not open this port to the public internet.

Not inherently required: Docker, VPS, domain, or Cloudflare. Authentication is strongly recommended if the network is not fully trusted.

## C. Hosted PWA with fictional/public data

Recommended hosted pattern: run the provided Docker Compose service on one stateful host, keep its `/data` volume persistent, and place an HTTPS reverse proxy in front of it.

The repository provides:

- `Dockerfile`
- `docker-compose.vps.yml`
- Loopback publication on host port `3100`
- A persistent `travel-reference-state` volume
- An application health check

Typical sequence on a prepared Docker host:

```text
docker compose -f docker-compose.vps.yml up -d --build
```

Configure the host's HTTPS reverse proxy to forward the chosen HTTPS site to `http://127.0.0.1:3100`. Reverse-proxy product setup is intentionally not automated here because it controls certificates, public exposure, and access policy.

Required for reliable hosted PWA behavior:

- A stateful Node or Docker host
- Persistent writable storage for `/data`
- HTTPS

Usually helpful but not technically mandatory:

- A domain name, because ordinary certificate issuance is simplest with one
- Docker, because the repository already provides a repeatable container path

Not mandatory:

- Cloudflare
- A specific cloud provider
- Application authentication when the only data is intentionally public fiction

## D. Hosted PWA with real personal trip data

Do not expose the existing full application directly on an unrestricted public URL.

In addition to the requirements above, real-trip hosting requires an access-control layer in front of the application. Examples include an authenticated reverse proxy, an identity-aware access gateway, or a private VPN that limits who can reach the server. Selecting and configuring that security boundary is deployment-specific and is not built into this repository.

Minimum expectations:

- HTTPS
- Access control before requests reach `server.mjs`
- Persistent storage with appropriate host permissions and backups
- Restricted administrator access to the host and volume
- A plan for lost phones, revoked users, logs, and backups
- No secrets or ticket/QR payloads committed to the repository

Share-safe mode does not satisfy this requirement. It controls what the share-safe page requests and renders; it does not authenticate a visitor or prevent access to an unrestricted full route.

## Requirement matrix

| Use level | Node | Docker | VPS/stateful host | Domain | HTTPS | Authentication |
|---|---:|---:|---:|---:|---:|---:|
| Local laptop | Yes | No | No | No | No; localhost is sufficient | No |
| Trusted LAN browsing | Yes | No | No | No | Optional for browsing; needed for full PWA behavior | No on a fully trusted LAN |
| Hosted fictional/public PWA | Yes, directly or in container | Recommended, not mandatory | Yes, or equivalent stateful platform | Recommended, not mandatory | Yes | Optional |
| Hosted real personal trip | Yes, directly or in container | Recommended, not mandatory | Yes, or equivalent stateful platform | Recommended | Yes | **Yes, externally provided** |

## Production commands without Docker

On a stateful machine with Node installed:

```text
npm install
npm run build
npm start
```

Set `DATA_DIR` to a persistent writable directory. The default host remains loopback; deliberate public hosting should normally keep the app on loopback and let the HTTPS/access-control proxy be the public listener.

## Backups and reset behavior

The SQLite database contains mutable checklist and pending state, not the canonical itinerary. Canonical trip data remains in the repository's `data/` files.

- Back up the chosen persistent data directory if shared progress matters.
- Deleting the database resets mutable state.
- Replacing canonical traveler or packing identifiers can make older checklist keys obsolete.
- Never publish a database copied from a real trip as part of a public repository.
