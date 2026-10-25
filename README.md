# Privacy Frames

A static host for network isolated web applications. Paste an application URL, install it, then open the local copy. The trusted manager and runtime use separate origins. No application backend, request proxy, extension or modified browser is required.

The canonical library is **https://pf.damenh.com/**; installed applications run on **https://pf-runtime.damenh.com/** with their name and source identity in the URL. GitHub Pages is an entry point to the canonical library. Its origin also hosts the original Pitch Training application, so it is not trusted as a management origin.

## Run locally

Use Node 24 or newer. Clone this repository and `DamenH/privacy-frames-apps` as siblings, then:

```sh
npm ci
npx playwright install chromium firefox
npm run build
npm test
npm run test:pitch
npm run test:network
npm run serve
```

The network suite requires Linux `strace`; it traces only its fresh browser and deletes raw traces. The pitch suite downloads the current public Pitch Training build and uses synthetic audio, with no real microphone input.

Open http://127.0.0.1:4210/privacy-frames/. Notes is at http://127.0.0.1:4212/; Image, Reader and Adversary use 4213–4215; Playground uses 4217 and the no-manifest PWA uses 4218. Receiver port 4216 and runtime port 4211 are test instruments, not deployed dependencies. The automated separate-origin suites use a top-level runtime at `localhost:4211` to exercise cross-site storage behavior. Set `APPS_DIRECTORY` if the fixture repository is elsewhere.

## Install existing applications

Paste https://damenh.github.io/pitch-training/ into the library. No Privacy Frames manifest or application source changes are required. The supported website profile collects HTML resources and executes a conventional `sw.js` precache installation in a disposable host worker with limited capabilities. It waits for completion, terminates preparation and starts a fresh isolated document. The publisher never receives native runtime service-worker authority.

Publishers can alternatively provide the explicit `app.json` package convention described in the example repository. Cross-origin installation requires readable CORS responses. Unsupported worker operations reject; runtime never falls back to the network. General PWA compatibility is not assumed.

## Build and deploy

```sh
npm run build:production
wrangler deploy --config deployment/runtime.jsonc
wrangler deploy --config deployment/manager.jsonc
```

These configurations publish static assets only. The same host code supports a GitHub Pages project path; deploying an actual manager on Pages requires a dedicated origin that serves only trusted host content. The supplied workflow publishes an entry point that forwards to the dedicated manager origin. Unknown virtual app paths must remain 404s without the browser worker; do not enable a server SPA fallback.

Production configuration is in `deployment/build.mjs`. `MANAGER_URL`, `RUNTIME_URL`, `MANAGER_ORIGINS` and `PUBLISHER_URL` also configure individual builds. Only the canonical manager origin belongs in the runtime's production allowlist. Example publishers must use other origins; different paths on one hostname do not isolate them.

## Implementation and evidence

- `src/manager.js`, `src/connect.js`: library and authenticated top-level runtime connection.
- `src/worker.js`: package validation, management roles, virtual documents and installed-resource request gate.
- `src/guard.js`: pre-execution setup, context/navigation controls and scoped storage.
- `src/website.js`, `src/install-worker.js`: public preparation and explicit transition to isolation.
- `src/prepared-worker.js`: limited completed-precache compatibility interface.
- `test/`, `results/`: functional, hostile, storage, audio and independently observed network evidence.

[REPORT.md](REPORT.md) explains the threat model, architecture, supported features and measurement limits. The library serves it at `report.html`. Live verification uses:

```sh
HOST_URL=https://pf.damenh.com/ npm run test:deployed
```

This is a research demonstration for the documented browser/application profile. IFC and general application updates/migrations remain outside this implementation.
