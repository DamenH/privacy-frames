# A static host for network isolated web applications

## Aim

The host installs a web application from a URL and runs a local copy against private input. Installation can use the network. Once the application starts, its HTTP requests receive installed resources or fail. There is no network fallback.

The manager is the trusted installation interface: it accepts URLs, performs installation and launches applications. A separate runtime origin serves the installed copies. Both are static websites hosted on GitHub Pages. Installation, storage and enforcement run in the browser. Applications retain native JavaScript, asynchronous callbacks, DOM elements, canvas, audio and local file processing.

## Threat model

The developer and the entire application may be malicious. This includes its installation code, resources and dependencies. An application may try to disclose private input through a request, create an unrestricted execution context, navigate away, recover native browser capabilities or access another application's storage.

The browser, host implementation, host dependencies and static hosting origins are trusted. The user chooses what to install and supplies private input only after installation. The manager origin must contain only trusted content. The manager uses `pf.damenh.com`, the runtime uses `apps.pf.damenh.com`, and publishers use other origins. Separate paths on one hostname would share an origin.

The target is application-initiated network disclosure during isolated execution. Local display, audio playback and processing user-selected files are intended. Browser defects, malicious extensions, physical side channels, availability attacks, developer tools and deliberate browser-menu exports are outside this demonstration. All applications on the runtime origin remain subject to confinement, including applications that have not read private input. IFC and selective release of private information remain separate research questions.

## Installation

The host reads the supplied webpage and collects resources through its HTML, CSS and supported JavaScript dependencies. Cross-origin resources must permit credential-free browser reads through CORS. Downloads reject redirects and enforce resource and byte limits as data arrives. The installation limit is 100 MiB.

For supported precache PWAs, the host executes `install` and `activate` handlers in an [SES compartment](https://docs.endojs.org/documents/lockdown.html) inside a disposable, host-created worker. Publisher code receives an in-memory cache interface and a download broker. It receives no document, navigator, native storage, browser worker creation, raw networking or parent messaging. Preparation has no existing private application state and shows no application input interface. Completion waits for the handlers' explicit promises.

The host terminates the preparation worker and closes its broker before returning the installation. The runtime checks paths, markup, resource counts and SHA-256 digests before committing resources to browser-local storage. A failed preparation or validation does not publish an application. Isolated execution starts in a fresh document, with no surviving publisher installation context or connection.

The publisher's [service worker](https://www.w3.org/TR/service-workers/) never becomes the isolated document's native controller. A compatibility interface reports completed precaching to applications that inspect their registration. Publisher fetch handlers and their network fallback do not execute during runtime.

## Confinement

An application opens at `/<ALIAS>/<NAME>/`, preserving its own hash route. The service worker generates an initial document containing only trusted setup code. If setup fails, no application markup or script is admitted. Direct requests to these virtual URLs without a controlling worker return a static 404.

Firefox testing exposed a limit of service-worker interception: the browser resolved attacker-selected hostnames before the worker rejected their HTTP requests. The runtime therefore combines a runtime-origin-only Content Security Policy (CSP) with the worker's cache-or-block policy. CSP prevents external DNS lookups through those requests; the worker prevents disclosure through arbitrary requests to the allowed runtime origin. Installed publisher URLs are translated locally before native requests are created.

Application responses forbid [embedding](https://html.spec.whatwg.org/multipage/iframe-embed-object.html), and startup requires a top-level document without an opener. This prevents an external parent from receiving private data through messaging. The [CSP sandbox](https://www.w3.org/TR/CSP/#directive-sandbox) and resource directives also block frames, objects, application workers, popups and downloads. Trusted setup validates markup before native parsing and checks operations that could create new execution contexts, including element creation, HTML setters, templates and node insertion. A protected Navigation API listener cancels document navigation while allowing fragment changes. Browsers without the required navigation enforcement refuse startup.

SES freezes JavaScript intrinsics, and setup captures native methods before application execution. These protect the machinery used by the runtime checks. Additional restrictions cover transports and browser-mediated services that can bypass ordinary HTTP interception, including WebSocket, WebRTC, worklets, remote speech and remote playback. The checked surfaces are recorded in [SURFACE_INVENTORY.md](https://github.com/privacy-frames/host/blob/main/SURFACE_INVENTORY.md).

## Storage and management

Local storage, session storage, IndexedDB and Cache Storage expose application-scoped names through their ordinary interfaces. Enforcement covers prototype calls, property access, enumeration and storage events. Applications cannot use these interfaces to open the host's installation database or another application's stores. Installation identity uses the full source-URL digest; choosing another application's display name does not inherit its storage. Public URLs use an 11-character alias derived from 64 digest bits, with collisions rejected during installation.

Browser permission grants, such as microphone access, are shared across applications on the runtime origin. Per-application permission mediation remains future work.

A trusted iframe on the runtime origin connects the manager to installation storage. Both endpoints check the actual peer window and browser-reported origin. The runtime worker separately authorizes management messages using a role bound to a trusted browser client. The bridge provides installation operations without exposing a general request proxy.

The manager and runtime use same-site, different-origin domains so iframe installation and top-level execution can share runtime storage. Startup checks storage access and worker control. Tests verify shared installation state for this same-site deployment. These checks alone do not detect a separate but accessible storage partition; cross-site controls demonstrate that limitation.

## Compatibility

The importer handles document base URLs, presentation attributes, nested CSS resources and publisher manifest metadata. It generates local PWA identity, scope, launch URLs and icons so supporting browsers can install applications individually. Publisher manifests cannot introduce file, share or protocol handlers.

Pitch Training was developed independently of the host and installs from its existing public URL without application source changes. Tests exercise its interface, sampled piano playback, microphone pitch analysis, settings, history and saved-score library. Wikipedia's REST HTML provides a separate document-import example. An independently developed Wasm image editor also starts and reloads offline. These use the general importer. Small fixtures exercise storage, private image processing and hostile browser operations; an editable playground lets a user try their own HTML, CSS and JavaScript.

## Evidence and remaining work

Browser tests run in Chromium and Firefox. They cover installation, scoped storage, management authorization, navigation and attempts to create unrestricted contexts. Unrestricted controls establish that the attempted operations work outside confinement. Audio tests check actual sample output and microphone analysis; storage tests read saved data back after reload and browser restart. Desktop Chromium tests also exercise native PWA installation.

Network tests use independent HTTP/TCP and STUN receivers and trace network-send syscalls from fresh browser processes. Controls must produce actual DNS sends, HTTP arrivals and STUN datagrams before a test can report that private markers were absent. Storage tests restore privacy settings that Playwright otherwise relaxes and compare same-site operation with a cross-site partitioning control. Browser versions, receipts and public deployment checks are recorded in `results/`.

This is an implementation and experimental evaluation over the documented browser surface. It has no machine-checked confinement proof. WebKit and real-device mobile PWA installation remain unverified. General application updates, confined dedicated workers and a browser-local recognition indicator remain future work. Worker support would require trusted setup in each worker context, with enforcement over its storage, messaging and effects before application code starts.
