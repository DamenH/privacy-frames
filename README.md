# Privacy Frames

Install a web application from its URL, then run a local copy with private input.
Installation can download public resources. During execution, requests receive
installed resources or fail.

The app manager is at **https://pf.damenh.com/**. Installed applications
run at **https://apps.pf.damenh.com/** using `/<short-source-id>/<app-name>/` URLs.
Installation uses a third origin, **https://install.pf.damenh.com/**. All three
sites use GitHub Pages. Origin-checked message channels through embedded iframes connect the manager to
the installer and runtime storage.

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

Open http://127.0.0.1:4210/privacy-frames/. The runtime uses port 4211 and the
installer uses 4219. Publishers use 4212–4215 and 4217–4218; the diagnostic receiver
uses 4366. These are separate origins, matching the production architecture.

Implementation lives in this repository. Example source lives in [privacy-frames/apps](https://github.com/privacy-frames/apps); the test build checks out the revision in `publisher-source-ref.txt`. Building creates
`dist-manager/`, `dist-runtime/`, `dist-installation/` and `dist-examples/`. React and Tailwind provide
the manager interface; installation, runtime enforcement and examples use
TypeScript. Prettier defines source formatting.

## Install an application

Paste its webpage URL into the manager and choose **Install**. Open the installed
copy from the list. Publishers need readable cross-origin responses through CORS.
The host follows explicit HTML and CSS references and literal JavaScript imports.
For dependencies loaded dynamically, provide an additional resource list by URL,
file upload or pasted text. Lists use `text/uri-list`: one absolute HTTPS URL per
line, with optional `#` comments. Catalog examples select their lists automatically. The total
installation limit is 100 MiB, with at most 1,000 resources.

A standard web app manifest can supply names, icons and launch preferences. The
host generates a local manifest for each installation. There is no host-specific
publisher manifest or application SDK.

No application code runs during installation. The installer downloads resources
and parses their declarations; it does not guess filenames or evaluate loaders.
An unavailable explicitly listed resource rejects installation. Unavailable
automatically discovered dependencies are recorded, while successful downloads
are retained. The entry document, resource limits and admission checks remain
mandatory. Missing resources fail locally during execution.

Application service-worker behavior runs inside confinement using admitted
resources. It cannot replace the host controller or provide network fallback.
Installations use one resource format; packages from the previous installer must
be reinstalled. Private application storage is kept separately.

## Share an installation

Choose **Copy link** below the installation form to share its application URL and
selected resource list. Pasted and uploaded lists are embedded in the link. A
list selected by URL stays a URL in a form share. Each installed application also
has **Copy link**; this embeds the resolved additional resource URLs recorded at
installation, without requiring the original list file or list server.

Opening a share link automatically opens an installed copy with the same source
URL. If it is not installed, Privacy Frames downloads the resources through its
separate installer, admits the local copy and opens it in the same tab. A spinner,
the application URL and progress text appear while this happens. Errors show an
explanation and a link back to the library.

The resource list is used for the first installation. An existing copy opens
without fetching the list or publisher resources, even if the link specifies a
different list. Following a share link does not replace an existing installation
or its private storage. The share screen is replaced in browser history so Back
does not immediately reopen the application.

Share links contain only fragment parameters, for example:

```text
https://pf.damenh.com/#v=1&url=https%3A%2F%2Fexample.com%2Fapp%2F&list-url=https%3A%2F%2Fexample.com%2Fresources.uris
```

Version 1 accepts `url` and at most one of `list-url`, `list` (an embedded URI list)
or `list-gzip` (a gzip-compressed UTF-8 URI list encoded as unpadded base64url).
Parameters use URL form encoding. Longer embedded lists are compressed when this
shortens the link. Generated links are limited to 32,768 characters; decoded
lists retain the installer's 256 KiB and 1,000-URL limits. Oversized recipes ask
for a list URL instead. Unsupported versions, duplicate parameters and malformed
lists are refused before installation.

The fragment is not sent in the host's HTTP request. Installing still downloads
from publishers, and publisher content can change after a link is created.
Links carry an installation recipe, not application bytes or private application
storage. Opening a link starts publisher downloads only when the app is not installed.

Run `npm run build` followed by `npm run test:share` for codec tests and the local
Chromium/Firefox recipient flows. `results/share-links.json` records browser
versions, source revision, source and build hashes, and the checks completed.
Screenshots include a narrow viewport; these are desktop browser tests, not
real-device mobile or desktop PWA installation evidence.

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
HOST_URL=https://pf.damenh.com/ DOCUMENT_URL=https://privacy-frames.github.io/apps/ordinary/document/index.html LIVE_ARTICLE=1 LIVE_PITCH_NATIVE=1 npm run test:compatibility
npm run test:assets
```

[Compatibility results](evaluation/compatibility.md) link each comparison to its
receipts and tested revision. Receipts record browser versions and scope in `results/`.
The [confinement verification results](formal/RESULTS.md) describe the models,
receiver tests, findings and remaining gaps.

## Deployment

`deployment/config.json` specifies trusted origins and example links. The manager
Pages workflow publishes `dist-manager/`. The deployment-only
[privacy-frames/runtime](https://github.com/privacy-frames/runtime)
repository publishes `dist-runtime/` from a pinned revision of this repository.
The [installation publisher](https://github.com/privacy-frames/installation)
builds `dist-installation/` from its own tested source pin. Release all three roles
from the same verified host revision. Configure `pf.damenh.com`,
`apps.pf.damenh.com` and `install.pf.damenh.com` in their GitHub Pages settings and
point their DNS CNAMEs to `privacy-frames.github.io`.

Examples are untrusted publisher content, published at `https://privacy-frames.github.io/apps/`. Their assets must stay off all three trusted origins.
Separate paths on a shared hostname do not create origin isolation.

The deployment requires static hosting only. Virtual application URLs return
static 404s until the browser's host service worker handles them. No server-side
routing or SPA fallback is used.

[REPORT.md](REPORT.md) explains the threat model and security argument.
[IMPLEMENTATION.md](IMPLEMENTATION.md) maps the implementation boundaries, and
[SURFACE_INVENTORY.md](SURFACE_INVENTORY.md) records the enforcement surfaces.
