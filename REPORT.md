# A static host for network isolated web applications

## Aim and result

The host installs a web application from a URL and runs a local copy against private input. Installation can use the network. Once the application starts, its HTTP requests receive installed resources or fail. There is no network fallback.

The manager is the trusted application library: it accepts URLs, performs installation and launches applications. A separate runtime origin serves the installed copies. Both are static websites. Installation, storage and enforcement run in the browser; no extension, application backend, request proxy or modified browser is required. The source consists of one host repository and one example repository.

The examples include notes, an image editor with access to uploaded pixels, an offline reader, a hostile application, an editable HTML/CSS/JavaScript playground and a conventional offline PWA. Pitch Training, developed independently of this host, installs from its existing public URL without application source changes. Its Svelte interface, sampled piano playback, microphone pitch analysis, settings, history and saved-score library work in the supported runtime.

## Threat model

The developer and the entire application may be malicious. This includes its installation code, resources and dependencies. An application may try to send private input through a request, create an unrestricted execution context, navigate away, recover native browser capabilities or access another application's storage. A manifest describes a package; it does not certify its safety.

The browser, host implementation, host dependencies and static hosting origins are trusted. The user chooses what to install and supplies private input only after installation. The manager origin must contain only trusted content. Separate project paths on one GitHub Pages hostname do not create separate origins. The canonical manager therefore uses `pf.damenh.com`, the runtime uses `pf-apps.damenh.com`, and publishers use other origins. Both trusted sites are hosted on GitHub Pages with configured custom domains.

The target is application-initiated network disclosure during isolated execution. Local display, audio playback and processing user-selected files are intended. Browser defects, malicious extensions, physical side channels, infinite-loop availability attacks, developer tools and deliberate browser-menu exports are outside this demonstration. IFC and selective release of private information are not implemented. All applications on the runtime origin remain subject to confinement, including applications that have not read private input.

## Installation and the transition to isolation

The host supports two installation paths. A cooperative publisher can provide `app.json` with an entry document and resource list. Otherwise, the host reads the supplied HTML URL, collects its script/style resources and looks for a conventional `sw.js` precache worker. Cross-origin resources must permit the browser to read their responses through CORS. Requests omit credentials and reject redirects. The existing Pitch Training publisher supplies the necessary CORS headers.

For a PWA, the host executes supported `install` and `activate` handlers in an SES compartment inside a disposable, host-created worker. Publisher code receives an in-memory cache interface and a download broker. It receives no document, navigator, native storage, browser worker creation, raw networking or parent messaging. Preparation has no existing private application state and shows no application input interface. The broker reads public resources and captures generated cache responses. Completion waits for the handlers' explicit promises; it is not inferred from network idleness.

The host terminates the preparation worker and closes its broker before returning the package. Isolated execution starts in a fresh document. No installation execution context or publisher connection is carried into it. The application may process private input only in this isolated phase.

The runtime checks paths, markup, resource counts and SHA-256 digests before committing the package to browser-local IndexedDB. Limits are 100 resources and 20 MiB. Website downloads enforce the byte limit while streaming; the older explicit-manifest path checks after reading each response. A failed preparation or validation does not publish an application. Installation identity includes the full digest of its source URL, so another source cannot inherit storage merely by choosing the same display name.

The publisher's worker never becomes the isolated document's native controller. A small compatibility object reports the completed precache installation and provides registration/readiness operations for that installed worker. Alternate registrations, updates, worker messaging and navigation preload changes reject. Publisher fetch handlers and their network fallback do not execute during runtime. This is a defined precache compatibility profile, not a complete implementation of service workers.

## Documents and individual PWAs

Document preparation handles ordinary HTML base URL semantics before removing the base element. It resolves resource references and captures nested CSS imports, CSS images and a fixed image candidate instead of retaining an uncaptured responsive-image list. Runtime still forbids new base elements and does not fetch missing resources. Wikipedia's REST HTML is an independent compatibility example using this same importer, with no publisher-specific adapter or exception. Ordinary navigation links are not recursively installed.

When present and readable, a publisher manifest supplies presentation metadata and supported launch preferences. The host rewrites identity, scope, launch URLs, icon URLs and admitted shortcuts to the local installation. Malformed or unavailable optional metadata falls back to the host's metadata and bundled icons. Manifest and icon routes expose only public installation data; they do not grant worker authority or a general network route. The original manifest cannot introduce file, share or protocol handlers.

Each installed application has its own manifest identity and can be installed separately by supporting browsers. The host service worker remains its native controller. Scope is a navigation boundary, not origin or storage isolation. The trusted bootstrap keeps the generated manifest link attached while loading the application so the browser's native installer can inspect it reliably. The browser-local glyph recognition idea is deferred for further design.

## Runtime and storage

An application opens at `/<ALIAS>/<NAME>/`, preserving its own hash route. The alias is the first 64 source-digest bits encoded as 11 unpadded base64url characters. The full source identity still governs storage and admission; alias collisions are rejected before commitment. The name is a readable canonical label, not an authority. The service worker generates an initial document containing only trusted setup code. If setup fails, no application markup or script is admitted. A direct request to that virtual URL without a controlling worker returns a static 404.

The application uses native JavaScript, asynchronous callbacks, DOM elements, canvas, Web Audio and fetch. This implementation does not provide a DOM membrane or substitute widget language. Resource mapping preserves installed relative resources, module imports and original root-relative paths. Exact publisher URLs are mapped to local installed URLs for fetch, XHR, cache downloads, prepared HTML/CSS and supported DOM URL setters, without rewriting application JavaScript. Hash routing remains local, including across offline reloads. Uninstalled resources, altered queries and document navigation do not acquire network access.

Firefox testing exposed an important limit of service-worker interception: it resolved attacker-selected hostnames before the worker rejected their HTTP requests. The runtime therefore combines a runtime-origin-only CSP with the worker's cache-or-block policy. CSP prevents those external DNS lookups; the worker prevents disclosure through arbitrary requests to the allowed runtime origin. Original installed resource URLs are translated locally before native requests are created. Neither control is sufficient by itself.

Local and session storage expose application-scoped keys through their ordinary interfaces. Methods, named properties, enumeration, key indexing and storage events are mediated. An early test found that `StorageEvent.storageArea` exposed the original native storage object; that route is now closed, and events from other namespaces are suppressed before application handlers run. Same-application windows receive scoped events; session storage remains local to its browsing context.

IndexedDB and Cache Storage factory methods prefix names, including calls recovered through their prototypes. Applications see their own names, native IndexedDB requests and transactions, and ordinary cache objects. They cannot enumerate or open the host's database or bootstrap caches through these factories. Cache downloads map installed publisher URLs locally while retaining the original cache keys; requests still cross the host worker's gate. Alternative storage-access handles and legacy filesystem entry points are refused. Full update/migration and data-retirement semantics remain deferred.

## Management and preventing escape

A trusted iframe on the runtime origin accepts a manager connection only from its actual parent window and the configured browser-reported manager origin. The manager sends messages only to its own iframe and the exact runtime origin. Applications launch without openers. Management messages go through MessagePorts; the runtime worker independently checks the browser client and a management role issued for trusted document loads. An application-supplied URL or claimed role is insufficient. The bridge does not proxy arbitrary network requests. The same-site, different-origin deployment allows the bridge and top-level applications to use runtime storage without a connection tab. Storage access and worker control are checked; a browser that denies them cannot silently proceed with a separate, empty installation partition.

Application responses forbid embedding with CSP `frame-ancestors` and `X-Frame-Options`; startup independently requires a top-level document without an opener. This prevents an external page from embedding an existing installation and receiving its private data through parent messaging. The trusted bridge is served separately and remains embeddable by the manager. An initial CSP response blocks frames, objects and workers. A top-level CSP sandbox also excludes popups and downloads. Trusted setup then checks markup before native parsing and checks context-producing operations synchronously: element creation, HTML setters, parser entry points, templates, Shadow DOM and node insertion. Document replacement, custom-element registration and new script agents are unavailable. A protected Navigation API listener cancels document navigation while allowing native-classified fragment changes. Unsupported navigation enforcement refuses startup.

SES freezes JavaScript intrinsics so application code cannot replace the language machinery used by these checks. Native methods used internally are captured before application execution. Script/link policy mutation, rich-HTML paste and drop, WebSocket, WebTransport, RTC, worklets, deferred networking, remote speech and remote playback are restricted. Text-only media metadata is permitted; URL-bearing OS media artwork is refused. Vite's inert link feature check and theme-color updates work without granting dynamic resource-policy insertion.

These controls address routes that service workers alone do not mediate. They form an argument over an enumerated browser surface, not a machine-checked proof of browser confinement. [Service Workers](https://www.w3.org/TR/service-workers/), [HTML iframe processing](https://html.spec.whatwg.org/multipage/iframe-embed-object.html), [CSP sandbox](https://www.w3.org/TR/CSP/#directive-sandbox), [SES lockdown](https://docs.endojs.org/documents/lockdown.html).

## Evidence and reproducibility

The browser launcher restores storage privacy settings that Playwright otherwise relaxes: Chromium storage partitioning and Firefox's standard partitioning policy. A separate cross-site control observes partitioned storage, while the deployment uses same-site origins and tests that iframe installation is visible to top-level execution. Automation defaults alone are not used as evidence of storage compatibility.

`npm test` covers markup policy, the original five applications, scoped storage, same-site cross-origin iframe operation and ordinary PWA preparation. The hostile application has 33 real-event probes and 31 additional direct probes. Ten unrestricted parser/context/agent controls establish that the corresponding operations function outside confinement. Test-only native messaging also checks worker management authorization independently of the application API restrictions.

`npm run test:pitch` installs the original Pitch Training URL in Chromium and Firefox. It independently compares installed executable digests with the publisher's bytes. UI interactions exercise sample playback, a completed exercise, score saving, settings and offline reload. The saved score is read back from IndexedDB, preventing a silent localStorage fallback from passing the database test. Native audio buffers contain nonzero samples and play in a running AudioContext. Chromium captures a generated 220 Hz WAV and detects approximately 220 Hz; Firefox detects its native synthetic input near 1000 Hz. Capture stops when requested. Chromium additionally tests denied microphone permission. Full Chromium is used because its lightweight headless shell does not support capture even in the unrestricted control.

`npm run test:network` uses independent HTTP/TCP and STUN UDP receivers and traces network-send syscalls from fresh test browser process trees. Synthetic DNS labels distinguish private attempts from unrestricted controls. The control must produce actual DNS sends, HTTP arrivals and STUN datagrams before a zero private-marker observation can pass. Raw traces are deleted after extracting the test evidence. This measures the tested routes, not every packet or every possible browser service. Fixed trusted worker-update requests are recorded separately from application requests.

`npm run test:compatibility` checks generic document preparation, inherited manifests, two native Chromium PWA installations, app launch and persistence across a full browser restart. `LIVE_ARTICLE=1` additionally checks the live Wikipedia article and captured images offline in both browsers. Native desktop Chromium installation is distinct from mobile viewport checks; real Android/iOS home-screen installation is not claimed.

The recorded browser versions and receipts are in `results/`. `test/deployed.mjs` repeats installation, launch, storage and hostile probes against the public deployments. Local receiver evidence and deployed browser evidence are reported separately. Public asset verification compares delivered hashes with the release files.

## Supported behavior and limits

| Feature | Behavior |
| --- | --- |
| Native DOM, asynchronous JavaScript, canvas, local files | Available within the checked surface |
| Installed fetch, images, CSS, modules and piano samples | Served locally; missing requests fail |
| localStorage, sessionStorage, IndexedDB and Cache Storage | Scoped to installation identity |
| Microphone and local audio analysis | Available after isolated launch, subject to browser permission |
| Cooperative packages and supported precache PWAs | Installable from a URL; CORS still applies |
| Publisher service-worker runtime behavior | Replaced by the stated compatibility profile |
| Frames, popups, new agents, arbitrary navigation and network transports | Refused |
| Individual PWA installation | Host-generated identity, scope, launch URL and local icons; browser installation UI varies |
| Worker updates, OS share/file/protocol handlers, downloads and custom elements | Outside the supported profile |
| Fine-grained IFC, selective release, general updates/migrations | Deferred or out of scope |

The main result is useful execution of an independently developed application under a deployable browser-local boundary. Browser APIs evolve, and the operation inventory and measurements must evolve with them. A successful fixture establishes its tested behavior; it does not establish compatibility with every PWA or complete noninterference for JavaScript.
