# Privacy Frames

A static host for network isolated web applications. Paste an application URL, install it, then open the local copy. The trusted manager and runtime use separate origins. No application backend, request proxy, extension or modified browser is required.

The canonical library is **https://pf.damenh.com/**; installed applications run on **https://pf-apps.damenh.com/** at `/<short-source-id>/<app-name>/`. Both sites are hosted on GitHub Pages using repository custom-domain settings. The manager connects automatically through a trusted iframe; installation needs no connection tab. The shared `damenh.github.io` origin is not a trusted management origin.

## Run locally

Use Node 24 or newer. Clone this repository and `DamenH/privacy-frames-apps` as siblings, then:

```sh
npm ci
npx playwright install chromium firefox
npm run build
npm run build:production
npm test
npm run test:pitch
npm run test:network
npm run test:upgrade
npm run test:mobile
npm run test:storage-policy
LIVE_ARTICLE=1 npm run test:compatibility
npm run serve
```

The network suite requires Linux `strace`; it traces only its fresh browser and deletes raw traces. The pitch suite downloads the current public Pitch Training build and uses synthetic audio, with no real microphone input.

Open http://127.0.0.1:4210/privacy-frames/. Notes is at http://127.0.0.1:4212/; Image, Reader and Adversary use 4213–4215; Playground uses 4217 and the no-manifest PWA uses 4218. Receiver port 4216 and runtime port 4211 are test instruments, not deployed dependencies. The separate-origin suites use an iframe at `127.0.0.1:4211`, then launch applications top-level against the same runtime storage. Set `APPS_DIRECTORY` if the fixture repository is elsewhere.

## Install existing applications

Paste https://damenh.github.io/pitch-training/ into the library. No Privacy Frames manifest or application source changes are required. The supported website profile collects HTML resources and executes a conventional `sw.js` precache installation in a disposable host worker with limited capabilities. It waits for completion, terminates preparation and starts a fresh isolated document. The publisher never receives native runtime service-worker authority.

Publishers can alternatively provide the explicit `app.json` package convention described in the example repository. Cross-origin installation requires readable CORS responses. Unsupported worker operations reject; runtime never falls back to the network. Generic document preparation resolves base URLs, nested CSS dependencies and fixed responsive-image choices. It captures supported publisher manifest metadata and generates a local manifest for individual PWA installation. Original JavaScript bytes stay unchanged; general PWA compatibility is not assumed.

## Build and deploy

```sh
npm run build:production
# Outputs: dist-manager/ and dist-runtime/
```

The host repository's Pages workflow publishes `dist-manager/` at `pf.damenh.com`.
The `privacy-frames-apps` repository's Pages workflow checks out the pinned host
revision in `runtime-host-ref.txt`, builds `dist-runtime/`, and publishes it at
`pf-apps.damenh.com`. Its publisher fixture sources stay on separate origins and
are not included in that runtime artifact. Configure both custom domains in
GitHub Pages settings and point their DNS CNAMEs to `damenh.github.io`.

Unknown virtual application paths return static 404s without the browser worker.
No server-side routing, Cloudflare Worker or SPA fallback is required. The former
runtime origin is retired; its browser-local installations must be reinstalled.
Their private data is not automatically transferred or deleted.

Production configuration is in `deployment/build.mjs`. `MANAGER_URL`, `RUNTIME_URL`, `MANAGER_ORIGINS` and `PUBLISHER_URL` also configure individual builds. Only the canonical manager origin belongs in the runtime's production allowlist. Example publishers must use other origins; different paths on one hostname do not isolate them.

## Implementation and evidence

- `src/manager.js`, `src/connect.js`: library and authenticated iframe bridge.
- `src/worker.js`: package validation, management roles, virtual documents and installed-resource request gate.
- `src/guard.js`: pre-execution setup, context/navigation controls and scoped storage.
- `src/website.js`, `src/install-worker.js`: public preparation and explicit transition to isolation.
- `src/document.js`, `src/pwa.js`: generic document adaptation and per-app manifests.
- `src/prepared-worker.js`: limited completed-precache compatibility interface.
- `test/`, `results/`: functional, hostile, storage, audio and independently observed network evidence.

[REPORT.md](REPORT.md) explains the threat model, architecture, supported features and measurement limits. The library serves it at `report.html`. Live verification uses:

`results/release.json` identifies the current release receipts and successful CI
run; older deployment receipts remain as historical experiment evidence.

```sh
HOST_URL=https://pf.damenh.com/ npm run test:deployed
```

This is a research demonstration for the documented browser/application profile. IFC and general application updates/migrations remain outside this implementation.
