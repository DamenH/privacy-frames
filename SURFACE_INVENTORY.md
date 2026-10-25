# Reviewed enforcement surface

This inventory accompanies the tested Chromium and Firefox versions recorded in
`results/`. It identifies the boundary and its evidence, not a proof that future
browser APIs are covered. Review new context, transport and native-service APIs
before claiming support for a new browser profile.

| Surface | Enforcement | Evidence |
| --- | --- | --- |
| Initial application HTML, SVG, MathML, templates | Lexical and parsed admission before native parsing | Policy tests; unrestricted parser controls |
| Frame/object/embed/portal creation and references | Creation, parser and insertion checks; protected references; CSP | Direct and real-event hostile probes |
| Native document parsers, document replacement, Range insertion, Shadow DOM | Synchronous checks or refusal | Hostile probes and unrestricted controls |
| Custom elements, customized built-ins, unsafe HTML setters, execCommand | Refused | Browser probes |
| Popups, picture-in-picture windows, history traversal and document navigation | Protected methods, Navigation API, CSP sandbox and no opener | Hostile event tests, named-window tests, fault-injected refusal |
| Workers, shared workers, worklets, ShadowRealm, broadcast channels | Protected constructors/methods and worker-src none | Probes; working unrestricted audio-worklet control |
| Script/link/meta policy mutation, attribute and Attr routes, rich paste/drop | Protected setters/mutators and insertion; theme-color exception | Hostile probes, Vite/Svelte compatibility test |
| Fetch, XHR, image/CSS/media/font loads, cache downloads | Exact installed-resource aliases; self-only CSP; worker gate | Original-URL alias test; functional examples; independent DNS/HTTP tests |
| Preconnect, DNS-prefetch, prefetch, prerender, modulepreload, speculation rules | Resource-policy mutation/insertion refused; CSP | Independent DNS tests with unrestricted control |
| WebSocket, WebTransport, RTC and deferred networking | Protected constructors/prototypes | Hostile tests; full-browser RTC/STUN UDP controls |
| Speech, remote playback and URL-bearing media artwork | Remote operations/artwork refused; local audio/text metadata retained | Probes; pitch sample playback and capture tests |
| Service-worker registration, messaging, updates and navigation preload | Native authority refused; supported precache readiness object only | Management attacks; ordinary PWA tests; unsupported-operation tests |
| Local/session storage, property access, clear and storage events | Namespace views and native event mediation | Cross-app and same-app storage suite; synthetic raw-storage escape regression |
| IndexedDB, Cache Storage and recovered prototype methods | Factory namespaces, scoped enumeration and native IDB behavior | Cross-app database/cache tests, actual saved-score records |
| Storage-access handles, legacy filesystem and WebSQL entry points | Refused | Authority probes and implementation checks |
| Host management | Exact opener/origin handshake and browser-client roles; app URL pinned | Separate-runtime suite and native test-only management attack |
| Publisher installation program | SES compartment, limited broker, disposable worker, explicit completion | Conventional PWA fixture, absent-authority receipt and rejected preparation |

Native browser UI, extensions, browser defects, physical/timing channels and
availability are outside this demonstration. Physical network evidence covers the
explicit calibrated routes, not all browser-process traffic. Fixed trusted worker
update requests are kept separate from application traffic. Real browser user
permissions still govern microphone capture.
