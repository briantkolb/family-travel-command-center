# Dependency Security Status

Dependency advisories are intentionally visible. `.npmrc` does not disable npm auditing, and the ordinary launchers allow `npm install` to report current results.

## v1.2 upgrade set

The v1.2 hardening release updates the stable compatible application/build stack: Next `16.3.1`, React/React DOM `19.2.8`, Playwright `1.62.1`, Vite `8.2.1`, `@vitejs/plugin-react` `6.0.5`, `@vitejs/plugin-rsc` `0.5.34`, `eslint-config-next` `16.3.1`, React Server DOM Webpack `19.2.8`, and Sharp `0.35.3`. Vinext remains pinned to `0.0.50`; moving to its `1.0.0` beta changes the build layout and is not a compatible security-only update.

The container uses a separately locked `runtime/package.json` dependency closure for the supported `node server.mjs` → `vinext start` path. It includes Vinext, Vite and its React/RSC plugins, React, React DOM, and React Server DOM Webpack. Next is required to build the source application but is not imported by the already-built production server path, so it is deliberately absent from the final image. This also prevents Next's optional Sharp and Playwright relationships from pulling build/test tooling into production. TypeScript is likewise absent because no runtime module imports it.

Run:

```text
npm audit
npm outdated
```

Review the exact lockfile graph rather than suppressing or counting notices globally.

## Known residual advisories

At the time of the v1.2 hardening work, `npm audit` reports two high-severity denial-of-service advisories for `image-size@2.0.2`, a pinned transitive dependency of Vinext:

- ICNS parser infinite loop: [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr)
- JXL/HEIF parser infinite loops: [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq)

The available automated fix installs `vinext@1.0.0-beta.6` and is therefore breaking. Do not use `npm audit fix --force` without a separate Vinext migration and full build/runtime review.

Vinext imports `image-size` transitively, and independently removing it breaks the supported build/start dependency closure. Vinext uses its vulnerable parsing call for developer-authored Next-style metadata image files. This application defines no such metadata routes and has no production HTTP request, body, upload, or query path that can supply attacker-controlled bytes to `image-size`. The two advisories therefore remain visible and documented but are assessed as unreachable under this application's current production input model.

This assessment must be revisited if the app adds user-supplied images, `next/image`, dynamic metadata images, untrusted build inputs, or a different Vinext runtime path. Prefer a stable Vinext release that upgrades `image-size` when one becomes compatible.
