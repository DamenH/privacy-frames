# Enforcement surface

This inventory describes controls in the current source. Receipts in `results/`
identify the revisions and browser versions actually measured. Final regressions,
corpus evaluation, independent network checks and public deployment of the current
batch remain pending.

| Surface                                                   | Current control                                                                                                                            | Verification to inspect or renew                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Initial HTML/SVG, templates and resource declarations     | Compile content against the admitted graph; prepare the realm before execution                                                             | Document compiler, renderer and installation fixtures                       |
| Dynamic markup, Range, Shadow DOM and inert documents     | Viewless native parsing checks actual nodes before live insertion; compiler checks remain                                                  | Native markup, inert-document and renderer fixtures with native controls    |
| Dynamic scripts, links, attributes and resources          | Map installed resources locally; uncaptured script loads fail through a local placeholder                                                  | Script events/order, resource-element and independent receiver tests        |
| Custom elements                                           | Admit autonomous definitions; deny customized built-ins                                                                                    | Custom-element fixture and hostile context creation                         |
| Frames, objects and child HTML/SVG                        | Host creates and prepares the context; pending references stay hidden                                                                      | Document lifecycle, parser, indexed-window and recursive-context fixtures   |
| Popups and named windows                                  | Host prepares a private Window and exposes a mediated facade                                                                               | Popup lifecycle and inherited getter/method/setter receiver controls        |
| Document navigation and history                           | Cancel document exits; scope root same-document URL updates to the installed application                                                   | History, navigation, foreign URL and management-identity tests              |
| External embedding and openers                            | Deny external framing; root apps launch without an opener                                                                                  | Embedding and private-canary receiver controls                              |
| Dedicated/shared workers and worklets                     | Trusted bootstrap and inherited application resource identity before publisher code                                                        | Classic/module/Blob/nested workers, shared connections and worklets         |
| Broadcast channels, ShadowRealm and unadapted contexts    | Refuse unsupported context routes                                                                                                          | Context policy probes                                                       |
| Fetch, XHR, images, CSS, media, fonts and cache downloads | Exact installed-resource aliases, runtime-only CSP and no worker network fallback                                                          | Original URL fixtures; independent DNS/HTTP/TCP observations                |
| Resource hints and speculation                            | Capture supported installation hints; reject uncontrolled runtime hints                                                                    | DNS controls and hostile insertion tests                                    |
| WebAssembly                                               | Execute inside the prepared realm; imports inherit its effects policy                                                                      | Wasm task and host-function network probes                                  |
| WebSocket, WebTransport, WebRTC and deferred networking   | Protected constructors/prototypes; same-origin transport also denied                                                                       | External receivers, same-runtime WebSocket upgrade controls and native STUN |
| Speech, remote playback and OS artwork URLs               | Refuse remote operations and URL-bearing artwork; retain local audio/text metadata                                                         | Transport and media fixtures                                                |
| Publisher service workers                                 | Prepared executors and mediated lifecycle/fetch/message operations; host keeps native control                                              | Publisher fixtures, executable-response and role attacks                    |
| Public language extensions                                | Permit reviewed prototype/static/native-function metadata extensions; protect enforcement operations, implicit hooks and Error stack hooks | Intrinsic compatibility, prototype interception and global-binding fixtures |
| Trusted state                                             | Explicit private arrays/Maps/Sets/records/descriptors/options and captured native operations                                               | Primordial unit tests, raw-context interception and popup receiver controls |
| Local/session storage and events                          | Namespace operations and filter exposed handles/events                                                                                     | Same-app persistence and namespace regressions                              |
| IndexedDB and Cache Storage                               | Scoped factory names and native transaction/response behavior                                                                              | Database/cache round trips, prototype routes and application tasks          |
| Alternative storage handles, legacy filesystem and WebSQL | Refuse unsupported authority                                                                                                               | Storage-access and authority probes                                         |
| Host storage and admission                                | Separate metadata/bodies; reconstruct and validate package before publication                                                              | Admission, integrity, replacement and response-policy tests                 |
| Management                                                | Exact origin/window channel authentication and browser-client roles                                                                        | Separate-origin and test-only native management attacks                     |
| PWA metadata                                              | Adapt admitted manifest data into host-owned app identity/scope                                                                            | Manifest and native desktop installation checks                             |
| Installation                                              | Separate authenticated origin/session; serialized capture; restricted disposable precache worker                                           | Installation-origin, session and preparation fixtures                       |
| Partial captures                                          | Retain successful ordinary downloads; missing resources have no runtime network fallback                                                   | Partial-capture unit tests and functional/offline corpus tasks              |

The prototype shares a runtime origin across installed apps. Storage namespacing
is useful behavior, but cross-application storage and browser-permission isolation
are not guarantees. Browser UI, extensions, browser defects, physical side
channels and availability are outside the threat model. Microphone access still
requires browser permission.

Network conclusions apply to calibrated routes in the recorded build. Host
service-worker update traffic must be distinguished from application traffic.
