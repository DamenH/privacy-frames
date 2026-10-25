# A static host for network isolated web applications

## Aim and result

The aim is to let an untrusted JavaScript application work on private data without maintaining a connection to its publisher. A user installs an application from a URL, opens the installed copy, and gives it input. Installation may use the network. Application execution uses installed resources and rejects other requests.

The implementation is a static application library, a runtime on that same origin, and independent example publishers. Installation and storage take place in the browser. No extension, application backend, server-side request proxy or modified browser is required. One repository contains the complete host and runtime. A second repository contains the test applications, published under a separate origin. The host works under a GitHub Pages project path or an existing static share directory.

The working examples include editing and persisting notes, reading an image file and modifying its pixels, fetching an installed article, and an editable HTML/CSS/JavaScript playground. A hostile application exercises the boundary. The playground starts with a script that tries to send its editable preview input to its publisher; an unrestricted control reaches the receiver, while the installed copy is blocked. Editing and rerunning HTML, CSS and JavaScript works without creating an iframe. Chromium and Firefox run the same application packages. Recorded tests establish useful application execution and rejection of the tested escape routes; they do not establish complete coverage of every browser communication mechanism.

## Threat model

The application developer and every resource supplied by the publisher may be malicious. A publisher may deliberately create new documents, recover untouched browser APIs, navigate with private data in a URL, or change the host's installation state. An installation manifest is an untrusted declaration, not a security certificate.

The browser, static hosting origins, host code, dependencies and user-selected installation operation are trusted. The library origin must serve only content trusted to hold management authority. Installed applications share the host origin and launch without an opener. The host therefore relies on its pre-execution restrictions and worker authorization to protect management state; the browser same-origin policy does not separate them. The runtime excludes additional windows, frames, workers and application-controlled worklets. Developers can target this restricted platform.

The target is application-initiated network disclosure during runtime. Displaying private content in the application is intended. Availability against infinite loops, user-operated developer tools, browser-menu exports, browser extensions and browser defects are outside the demonstrated guarantee. The page context menu is suppressed, but this is not presented as control over browser UI. Fine-grained IFC and selective authorized network release are not implemented.

## Installation and management

A publisher provides an `app.json` manifest declaring an ID, name, HTML entry and all resources. The library fetches these without credentials, requires CORS permission for cross-origin installation, rejects redirects and validates paths and markup. Packages are limited to 100 resources and 20 MiB of resource bytes. The current downloader checks the byte limit after each resource is read; it is not a streaming defense against a maliciously huge response.

The library registers its worker directly and sends installation operations over MessagePorts. The worker obtains the sending WindowClient from the browser and accepts management only from the canonical library URL. It does not trust an origin or client URL supplied in the message. It independently validates the manifest and resource digests and commits the complete package in one IndexedDB transaction. Failed downloads and failed validation do not expose a partial installation. No installer iframe or separate runtime service is involved.

The installation identity incorporates the full SHA-256 digest of the manifest URL and the declared ID. Another publisher claiming `notes` therefore receives a different storage namespace. SHA-256 digests check the resource transfer contract; the publisher supplies no trusted signature and is not assumed honest.

The worker accepts management messages only from the canonical library client. The application cannot obtain worker-management, CacheStorage or IndexedDB authority. Open runtime windows prevent replacement or removal of their installation. Application localStorage and sessionStorage are replaced by scoped interfaces; removing an installation also clears its localStorage namespace through the trusted library. Session storage in a closed application tab ends with that tab.

## Runtime entry and HTTP handling

An installed application has a virtual URL under `run/INSTALLATION/`. The service worker generates its document. The initial response contains only the trusted bootstrap script, so failure to establish the policy cannot fall through into application scripts. Unknown virtual URLs on the static server have no application content to execute without the worker.

The bootstrap establishes restrictions, obtains prepared content from the worker, and then inserts the application markup and loads declared external scripts. The application keeps ordinary JavaScript, asynchronous callbacks, native DOM elements, canvas and fetch. It does not execute inside an emulated widget system or a DOM membrane.

The worker returns resources belonging to that installation, including installed resources requested through their original publisher URLs. Every other runtime HTTP request returns an error. There is no network fallback. POSTs, query-string variants and requests for another installation are not matched as installed resources. Bootstrap resources are cached under a build-specific identity. The library disables navigation preload before declaring readiness.

Service workers can synthesize responses, but are not a general browser firewall. This distinction motivates the separate navigation and execution-context controls. [Service Workers specification](https://www.w3.org/TR/service-workers/)

## Preventing fresh execution contexts

An initial CSP response header prohibits frames, objects and workers. It is reinforced by admission and synchronous DOM restrictions because an initial blank frame can exist before an external frame load is blocked. Removing a frame afterward would leave an opportunity to obtain untouched APIs. [HTML iframe processing](https://html.spec.whatwg.org/multipage/iframe-embed-object.html)

The argument for the supported profile has three parts:

1. Installed markup is checked before native parsing. A conservative lexical gate rejects context-producing tag spellings independently of HTML, SVG or MathML parser context. A parse5 traversal checks elements, attributes, templates and packaged scripts. The lexical check intentionally rejects some harmless comments and raw text too.
2. Runtime creation, markup parsing and node insertion are checked synchronously. This covers createElement and createElementNS, innerHTML and outerHTML, adjacent HTML, templates, Shadow DOM and insertion methods. Document parsers, document replacement, contextual fragments, newer unsafe HTML setters, custom-element registration and execCommand are refused. Getter restrictions on child-window references add another barrier.
3. Popups and alternate script agents are unavailable. Worker, SharedWorker, worklet loading and relevant additional context APIs are restricted. The application starts without another Window reference, and BroadcastChannel is unavailable.

Frozen JavaScript intrinsics, supplied by SES lockdown, prevent the application from replacing the validator's Array, String and related language machinery. DOM methods and getters used internally are captured before app execution; protected replacements cannot be reassigned. SES is used for language hardening, not as a claim that native browser capabilities are automatically safe. [Endo lockdown](https://docs.endojs.org/documents/lockdown.html)

This is an argument over an enumerated browser surface. A new browser operation that creates contexts without passing these gates requires review. It is not a machine-checked proof of the HTML implementation or completeness of the operation inventory.

## Navigation and other communication

The runtime uses the standard CSP sandbox on a top-level response, retaining scripts, origin and form interaction while omitting popup and download permissions. No iframe or Chromium extension sandbox is required. CSP sandbox must be supplied through the response header. [CSP sandbox directive](https://www.w3.org/TR/CSP/#directive-sandbox)

A protected Navigation API listener cancels document navigation and permits native-classified fragment changes. Modified and auxiliary clicks are cancelled. Document replacement and history traversal are restricted. pushState and replaceState may change fragments, but cannot change the runtime path or query: a client URL must not be allowed to impersonate the manager or another application.

The script policy excludes inline execution and unsafe eval. Local blob modules are admitted so the playground can execute edited code in the already restricted realm. This does not create a fresh browser context or grant new native capabilities. A regression check verifies that javascript: document replacement remains blocked. SES retains native evaluators here; CSP supplies the execution restriction. Eval checks run through actual browser clicks, because debugger evaluation is not evidence of what application scripts can execute. WebSocket, WebTransport and RTC constructors, worker-management operations, deferred fetch and several additional networking facilities are restricted. Native fetch remains available through the worker. Reflected properties and Attr mutations cannot activate policy-changing link or meta elements. Rich HTML paste/drop defaults are suppressed so browser-native insertion cannot silently bypass markup admission.

Navigation cancellation does not itself stop hyperlink auditing. Chromium's link ping request reached a receiver in the earlier standalone navigation experiment. The combined host worker intercepts that HTTP request. Browser-controlled worker update traffic remains a distinct host control-plane operation; this implementation does not claim the entire browser process becomes offline.

## Evaluation

Run `npm ci`, `npm run build`, and `npm test` in `privacy-frames`. The browser suite serves the library, runtime and five publishers on distinct loopback origins. A separate receiver records HTTP and WebSocket upgrade attempts. No private user information or Internet collection endpoint is used. The policy tests exercise rejected markup and paths before browser parsing.

The recorded browser versions are Chromium 153.0.8010.12 and Firefox 155.0. Both run the same bytes for installed and unrestricted applications. The tests exercise real keyboard and pointer interactions, reload, persistent notes, installed image loading and native fetch. The image fixture also checks local file input and exact decoded pixels.

The hostile application has 30 real-event checks. An additional 28 direct checks verify refusal and absence of a new child Window. Ten unrestricted parser/context/agent controls succeed, including a functioning audio worklet. The suite attempts diagnostic disclosure through fetch, XHR, images, CSS, link auditing, forms, location and sockets and checks that the marker reaches no local HTTP receiver and opens no TCP connection to the diagnostic receiver. Unrestricted controls produce receiver traffic. RTC constructor denial is tested here; the earlier RTC diagnostics provide calibrated UDP/STUN evidence for the underlying bypass, rather than a new end-to-end UDP observation in this host suite.

Lifecycle tests cover library reload, incomplete installation, replacement with an open app window, and identical declared IDs at different source URLs receiving distinct storage. The shared-origin checks verify that application storage cannot read, overwrite or clear host keys; raw prototype getters do not recover worker or storage authority; host resources cannot be fetched; named-window navigation cannot reach the manager; and fixed runtime URL identity cannot be spoofed. A test-only capability captured before setup invokes the native worker messaging method to verify the worker rejects application management commands independently of the JavaScript restriction. Fault injection removing the Navigation API refuses startup before application content, while an uncontrolled virtual runtime URL returns a plain static 404. Browser console policy errors are retained as observations, rather than treated as an absence of network transmission. Receiver observations and functional assertions are the deciding evidence.

The local result records 13 successful functional/security groups in each browser, alongside the individual probes. The test server places the host under `/privacy-frames/` to exercise GitHub Pages project-path behavior. Deployment verification repeats installation and launch from the published URLs. Result files distinguish deployed browser behavior from the independent HTTP/TCP receiver evidence gathered locally. A passing fixture does not support a claim about a route it never exercised.

## Restrictions and remaining work

Applications must package resources and external scripts, avoid inline handlers and runtime document creation, and use the supplied storage interfaces. Custom elements, arbitrary document routing, direct IndexedDB and application service workers are unavailable. The useful examples establish that these restrictions still permit native editing, asynchronous resource loading and pixel processing; they do not establish compatibility with arbitrary PWAs or every framework.

The library and runtime use the same origin and project prefix. Other independently executing content on that origin must also be trusted: another repository path on the same github.io hostname is not a security boundary. The test publisher uses a custom hostname for this reason. Merely creating a second GitHub repository would not make its unrestricted hostile code external to the host origin.

Additional browser networking APIs, speculative behavior, DNS/preconnect coverage, native browser UI and browser-version changes require continued review. The local suite observes HTTP/upgrade arrivals and TCP connections to its receiver, rather than all DNS, UDP or browser-process traffic. The earlier investigations contain broader channel diagnostics; they cannot substitute for observing every route in this implementation.

The implementation demonstrates a deployable static installation model and a useful restricted runtime. It also makes the remaining security work concrete: audit the operation inventory and measure channels beyond the current receiver, rather than infer complete confinement from a successful offline fetch.
