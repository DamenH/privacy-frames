# Privacy Frames

Install a web application from its URL, then run a local copy with private input.
Installation can download public resources. During execution, requests receive
installed resources or fail.

The app manager is at **https://pf.damenh.com/**. Installed applications
run at **https://apps.pf.damenh.com/** using `/<short-source-id>/<app-name>/` URLs.
Both trusted sites use GitHub Pages. An authenticated iframe connects the manager
to runtime storage automatically.

## Develop locally

Use Node 24 or newer:

```sh
npm ci
npx playwright install chromium firefox
npm run build
npm run typecheck
npm run format:check
npm test
npm run serve
```

Open http://127.0.0.1:4210/privacy-frames/. The local runtime uses port 4211.
Example publishers and the diagnostic receiver use ports 4212–4218. The local
server keeps manager, runtime and publisher origins separate, matching the
production architecture.

Implementation lives in this repository. Example source lives in [privacy-frames/apps](https://github.com/privacy-frames/apps); the test build checks out the revision in `publisher-source-ref.txt`. Building creates
`dist-manager/`, `dist-runtime/` and `dist-examples/`. React and Tailwind provide
the manager interface; installation, runtime enforcement and examples use
TypeScript. Prettier defines source formatting.

## Install an application

Paste its webpage URL into the manager and choose **Install**. Open the installed
copy from the list. Publishers need readable cross-origin responses through CORS.
The host discovers resources through standard webpage declarations, supported
module dependencies and supported service-worker precaching. The total
installation limit is 100 MiB, with at most 100 resources.

A standard web app manifest can supply names, icons and launch preferences. The
host generates a local manifest for each installation. There is no host-specific
publisher manifest or application SDK.

Publisher preparation ends before a fresh confined document starts. Application
service workers cannot replace the host controller or provide network fallback.
Missing resources fail during execution. Installation is therefore best suited to
applications that can work offline.

## Examples and tests

The visible examples emphasize note editing and installed resources, an editable
code playground and hostile browser probes. Smaller image, precache and document
fixtures remain focused automated tests. See [the publisher repository](https://github.com/privacy-frames/apps)
for their source and independent publisher setup.

Pitch Training, Wikipedia and an independently developed Wasm image editor
exercise the same importer as other applications. The Wasm fixture also checks
inline modules, preload declarations, relocated dependencies and offline startup.

```sh
npm run test:storage-policy
npm run test:mobile
npm run test:compatibility
npm run test:wasm
npm run test:pitch
npm run test:network
npm run test:embedding
```

The network suite requires Linux `strace` and uses independent HTTP/TCP and STUN
receivers. It traces fresh test browser processes and removes raw traces after
extracting results. The pitch suite downloads the public Pitch Training build
and uses synthetic microphone input.

Live deployment checks use:

```sh
HOST_URL=https://pf.damenh.com/ npm run test:deployed
HOST_URL=https://pf.damenh.com/ DOCUMENT_URL=https://pf-ordinary.damenh.com/document/index.html LIVE_ARTICLE=1 LIVE_PITCH_NATIVE=1 npm run test:compatibility
npm run test:assets
```

Test receipts record browser versions and scope in `results/`. Historical
receipts describe their recorded revisions; current changes need fresh results.

## Deployment

`deployment/config.json` specifies trusted origins and example links. The manager
Pages workflow publishes `dist-manager/`. The deployment-only
[privacy-frames/runtime](https://github.com/privacy-frames/runtime)
repository publishes `dist-runtime/` from a pinned revision of this repository.
Configure `pf.damenh.com` and `apps.pf.damenh.com` in the corresponding GitHub Pages
settings and point both DNS CNAMEs to `privacy-frames.github.io`.

Examples are untrusted publisher content, published at `https://privacy-frames.github.io/apps/`. Their assets must stay off both trusted origins.
Separate paths on a shared hostname do not create origin isolation.

The deployment requires static hosting only. Virtual application URLs return
static 404s until the browser's host service worker handles them. No server-side
routing or SPA fallback is used.

[REPORT.md](REPORT.md) explains the threat model and security argument.
[IMPLEMENTATION.md](IMPLEMENTATION.md) maps the implementation boundaries, and
[SURFACE_INVENTORY.md](SURFACE_INVENTORY.md) records the enforcement surfaces.
