# A static host for network isolated web applications

## Aim

The host installs a web application from a URL and runs a local copy against private input. Installation can use the network. During confined execution, HTTP requests must receive admitted local resources or fail. There is no network fallback.

Three static websites separate the trusted manager, installer and runtime. The manager accepts installation requests and launches applications. The installer collects resources; the runtime serves confined applications. They run in the browser without a backend and can be hosted on GitHub Pages. Applications retain JavaScript, asynchronous callbacks, DOM rendering, canvas, audio and local file processing.

## Threat model

The developer and the entire application may be malicious, including its dependencies. An application may try to disclose private input, create an unrestricted context, navigate away or recover a forbidden browser capability.

The browser, host implementation, host dependencies and hosting origins are trusted. The user supplies private input only after installation. The configured origins are `pf.damenh.com` for the manager, `install.pf.damenh.com` for installation and `apps.pf.damenh.com` for execution. Publishers use other origins. Untrusted application interfaces never run on the manager origin.

The target is application-initiated network disclosure. Local display, playback and file processing are intended. Browser defects, malicious extensions, physical side channels, availability attacks, developer tools and deliberate browser-menu exports are outside this demonstration. Installed applications share an origin; storage namespacing provides compatibility, without a guarantee of isolation between applications or their permission grants. Protecting the host's policy and setup code remains necessary for confinement.

## Installation

The installer follows explicit HTML and CSS references and literal JavaScript imports. For resources selected by application logic, a user or publisher can supply a plain URL list. The manager accepts a list URL, file or pasted text; catalog entries can supply one automatically. The application itself remains unchanged.

No application code runs during installation. Downloads omit credentials, require CORS access and reject redirects. Limits of 1,000 resources and 100 MiB apply as bytes arrive. The entry document and explicitly listed resources must download successfully. Other unavailable dependencies are recorded; missing resources fail locally during execution.

The runtime validates paths, content, counts and SHA-256 digests before committing the installation. Installation transfers resource bytes and metadata, not running JavaScript state. Publisher service-worker events run later inside prepared, confined executors; they cannot replace the native host controller or enable network fallback.

## Confinement

An application opens at `/<ALIAS>/<NAME>/`. The host service worker supplies an initial document containing only trusted setup code. Application code starts after its controls are established. The runtime also prepares child documents, popups, dedicated and shared workers, and supported worklets before their application code starts.

The runtime’s Content Security Policy (CSP) restricts HTTP requests to its own origin. Firefox experiments showed DNS resolution before service-worker rejection of external requests. CSP prevents those external requests; the service worker applies the cache-or-block rule within the allowed origin. Publisher resource URLs are mapped locally to admitted copies.

Runtime guards mediate context creation, navigation, script loading and browser services outside ordinary HTTP interception. WebSocket and WebRTC remain restricted. Same-application history paths, queries and fragments are supported. DOM construction and resource loading retain their checks when invoked from custom elements or dynamically evaluated code. The checked surfaces are recorded in [SURFACE_INVENTORY.md](https://github.com/privacy-frames/host/blob/main/SURFACE_INVENTORY.md).

Selected prototype extensions and polyfills are supported. Trusted runtime code uses captured native operations and explicitly protected internal records and collections. Publisher code retains its ordinary JavaScript environment within those restrictions. Dynamic code evaluation runs in the already prepared realm, under the same communication policy.

## Storage and management

Local storage, session storage, IndexedDB and Cache Storage use application-scoped names through ordinary APIs.

Origin-checked message channels connect the manager to installation and runtime storage. Runtime management also requires a role bound to an actual trusted browser client. Applications cannot use those interfaces to reopen installation or change the confinement policy. The runtime service worker continues enforcing requests when the manager is closed.

## Compatibility

The fixed [eight-application corpus](https://github.com/privacy-frames/host/blob/main/evaluation/compatibility.md) compares useful tasks in Chromium and Firefox, with standalone controls and offline checks. This compatibility pass changes the host rather than patching application behavior. Licensed mirrors relocate URLs for static hosting and retain their modification inventories.

Targeted local Squoosh tests encode a synthetic PNG into a smaller, decodable JPEG, change quality and verify different output bytes, then repeat the task offline. Other tasks include painting an image, editing a drawing, rendering Markdown and processing files. The [compatibility results](https://github.com/privacy-frames/host/blob/main/evaluation/compatibility.md) identify tested revisions, browser versions, local and deployed checks, and remaining failures.

## Evidence and remaining work

Hostile fixtures attempt communication from ordinary code, prototype hooks, custom-element callbacks and evaluated code, including newly created contexts. Independent HTTP, TCP, DNS and STUN observations accompany working unrestricted controls. Functional checks read saved data, inspect rendered output or decode generated files. Browser versions and revision evidence accompany receipts in `results/`.

These experiments cover a documented browser surface; they are not a machine-checked confinement proof. General updates, interactive preparation, per-application origins, WebKit and real-device mobile installation remain future work. IFC and selective release of private information are separate research questions.
