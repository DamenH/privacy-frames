# Privacy Frames

A static application host. Paste an application URL, install it, then open the installed copy. The library and runtime use the same origin. There is no application backend, installation iframe or separate runtime deployment.

## Run locally

Node 24 or newer is recommended. Clone this repository and `DamenH/privacy-frames-apps` as sibling directories:

```sh
npm ci
npx playwright install chromium firefox
npm run build
npm test
npm run serve
```

Open http://127.0.0.1:4210/privacy-frames/. Paste http://127.0.0.1:4212/ to install Notes. Other example applications are on ports 4213–4215; the editable playground is on 4217. The test-only HTTP/TCP receiver uses port 4216. Local servers are development instruments, not deployed runtime dependencies.

Set `APPS_DIRECTORY=/absolute/path/to/apps` if the publisher repository is elsewhere. The local test server deliberately uses a project prefix, matching GitHub Pages behavior.

## Deploy to GitHub Pages

The workflow builds `dist/` and publishes that directory. The service worker is at the project root and controls only that project prefix. No server headers or SPA fallback are required. Unknown virtual runtime paths must remain 404s without the worker.

`PUBLISHER_URL` optionally changes the examples base at build time; its default is `https://pf-apps.damenh.com/`. Each example has an independent manifest and can also be installed through a pasted URL.

The publisher needs a different origin. Another repository path on the same `damenh.github.io` hostname does not provide one. The publisher repository uses its own custom domain. Other freely executing code on the host origin must be trusted.

The deployment job is enabled by the repository variable `PAGES_ENABLED=true`, after Pages has been configured. The host workflow checks out the publisher fixtures when publishing. A private publisher repository requires a read-only deploy key supplied as `APPS_DEPLOY_KEY`; public publishers require no key.

## Implementation

- `src/manager.js`: library UI and direct worker management, authorized by the browser's client URL.
- `src/worker.js`: atomic package installation, host assets, runtime responses and cache-or-block application HTTP.
- `src/guard.js`: trusted pre-execution setup, language hardening, context/navigation/network restrictions and application-scoped storage.
- `src/package.js`: manifest/resource validation before browser parsing.
- `test/`: honest app interactions, hostile controls, same-origin management/state attacks and fail-closed entry checks.

Applications currently use the package convention documented in the publisher repository. The discussed explicit, network-enabled installation callback is not implemented by this UI and deployment change.

## Evidence

See [REPORT.md](REPORT.md) for the threat model, measurements and remaining boundaries. The host serves the same report at `report.html`. `results/browser.json` records local browser tests. The deployed share and GitHub Pages checks are retained separately. `test/deployed.mjs` repeats the published installation and execution flow:

```sh
HOST_URL=https://damenh.github.io/privacy-frames/ npm run test:deployed
```

The tests support the admitted application profile, not a universal browser-confinement proof. Browser-menu actions and complete DNS/UDP coverage remain outside the measured guarantee.
