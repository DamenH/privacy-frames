# Enforcement surface

This inventory maps browser capabilities to their intended controls and evidence.
The receipts in `results/` identify measured revisions and browser versions.
Changes to a control require fresh verification of its corresponding routes.

| Surface | Control | Evidence to inspect |
| --- | --- | --- |
| Initial HTML, SVG, MathML and templates | Lexical and parsed admission before native parsing | Policy tests and unrestricted parser controls |
| Initial script and resource declarations | Preparation captures admitted resources; runtime starts scripts only after guard setup | Import tests, ordinary website fixtures and compatibility tests |
| Dynamic script/link/meta insertion and mutation | Protected creation, setters, attributes, Attr objects and node insertion; narrowly admitted inert metadata operations | Hostile probes and ordinary framework startup |
| Frames, objects, embeds, portals and references to their contexts | Creation, parser and insertion checks, protected references and CSP | Direct and real-event hostile probes |
| Native document parsers, document replacement, Range and Shadow DOM | Synchronous checks or refusal | Hostile probes with working unrestricted controls |
| Custom elements, customized built-ins, unsafe HTML setters and execCommand | Refused | Browser probes |
| External embedding and opener-based messaging | Application responses deny framing; guard requires top-level execution without an opener | Embedding test with private canary and unrestricted receiver control |
| Popups, picture-in-picture windows, history traversal and document navigation | Protected methods, Navigation API and CSP sandbox | Real-event and named-window probes; startup refusal when enforcement is absent |
| Workers, shared workers, worklets, ShadowRealm and broadcast channels | Protected constructors and methods; application worker CSP | Agent probes and unrestricted worklet control |
| Fetch, XHR, images, CSS, media, fonts and cache downloads | Exact installed-resource aliases, runtime-origin-only CSP and cache-or-block worker | Original publisher URL tests, functional fixtures and independent DNS/HTTP observations |
| Preconnect, DNS-prefetch, prefetch, prerender and speculation rules | Initial hints handled during preparation; application resource-policy insertion remains refused | Independent DNS controls and hostile insertion probes |
| WebAssembly | Explicit script policy; imports use the already confined JavaScript environment | Wasm compatibility fixture and network attempts through imported host functions |
| WebSocket, WebTransport, WebRTC and deferred networking | Protected constructors and prototype methods | Hostile tests with HTTP/TCP and native STUN controls |
| Speech, remote playback and URL-bearing OS media artwork | Remote operations and artwork refused; local audio and text metadata retained | Transport probes, audio playback and capture tests |
| Publisher service-worker registration, messaging, updates and navigation preload | Native authority refused; completed precache compatibility interface only | Ordinary PWA preparation, unsupported-operation and management tests |
| Local/session storage, named properties, enumeration and clear | Per-application views; native prototype methods protected | Cross-application and same-application storage tests |
| Storage events and storageArea handles | Filter namespace before application listeners; expose scoped views | Native storage event tests and raw-storage escape regression |
| IndexedDB, Cache Storage and recovered prototype methods | Factory namespaces, scoped enumeration and native transaction behavior | Database/cache isolation and actual saved application records |
| Alternative storage-access handles, legacy filesystem and WebSQL | Refused | Authority probes and implementation inspection |
| Host installation metadata and resource bodies | Separate host-owned stores; runtime admission validates metadata and resource integrity | Admission tests, metadata/body separation and resource response tests |
| Host management | Exact parent/origin iframe handshake plus browser-client management roles | Separate-origin tests and native test-only management attacks |
| PWA metadata and icons | Fixed read-only public routes; host-generated identity and scope | Manifest adaptation and native desktop installation tests |
| Document base URLs, CSS and module dependencies | Resolve during public preparation; serve captured resources locally | Generic import fixtures and independent application tests |
| Publisher installation program | SES compartment, limited broker, disposable native worker and explicit completion | Absent-authority receipt, successful preparation and rejected installation |

Native browser UI, extensions, browser defects, physical side channels and
availability are outside the implementation's threat model. Network evidence
covers calibrated application routes; fixed host service-worker update requests
are recorded separately. Microphone access still requires browser permission.

A capability is supported only when its enforcement and intended behavior both
work in the recorded browser profile. New browser APIs need review against this
inventory before the host claims support for them.
