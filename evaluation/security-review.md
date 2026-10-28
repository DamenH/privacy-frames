# Confinement review

This document maps the current design to its security checks. It is a source
review with empirical fixtures, not a confinement proof or an external
penetration test. Final-source CI and public asset verification have passed;
public application task and host-interface checks have also passed.

## Boundaries reviewed

| Boundary                      | Current mechanism                                                                                           | Required checks                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Installation                  | Separate authenticated origin/session; host approval; serialized capture and restricted precaching          | Exact parent/origin/session attacks, duplicate sessions and worker disposal             |
| Admission                     | Runtime reconstructs metadata and validates paths, content, limits and digests                              | Invalid/partial packages cannot become published installations                          |
| Root startup                  | Trusted bootstrap captures operations and prepares effects before publisher markup/code                     | Setup failures leave publisher code unexecuted                                          |
| Child contexts                | Host-created workers, worklets, documents and popups inherit application/generation identity                | Pending references, recursive children, wrong parents and management attacks            |
| Resource loading              | Original URLs map to the admitted local graph; uncaptured resources fail locally                            | Runtime-origin and external receiver controls, including same-origin WebSockets         |
| Markup                        | Compiler checks plus viewless native parsing of actual nodes before insertion                               | HTML/SVG/MathML/template parser differences and dynamic insertion                       |
| Trusted state                 | Private arrays/Maps/Sets/records/descriptors/options; captured native operations                            | Prototype getters/setters, implicit protocols and raw-context interception              |
| Public language compatibility | Reviewed prototype/static/function metadata additions; protected operations, ancestry and Error stack hooks | Unchanged polyfills work while attempted replacement/reparenting fails                  |
| Management                    | Authenticated channels and actual browser-client roles                                                      | App-supplied role, URL or identity cannot authorize management                          |
| Publisher service workers     | Prepared executors and mediated events; host retains native response/controller authority                   | No arbitrary network proxy, executable-response injection or native controller takeover |
| Storage                       | Application namespaces and protected native factory/prototype routes                                        | Saved-data round trips, enumeration and namespace regressions                           |
| Lifecycle/navigation          | Scoped root history; prepared context publication; closed/replaced generation checks                        | Reload, cancellation, controller replacement and foreign navigation                     |

## Native references and prototype hooks

The runtime permits language extensions without giving trusted records the public
Object prototype. Collections and descriptor/option records are created through
explicit private helpers. Trusted JSON/parser outputs are normalized before
optional-field reads. Message envelopes are detached while application payloads
retain their application-facing semantics.

Native-looking handles require a separate receiver check. In the popup facade,
forwarding an inherited application getter with the private Window as receiver
would reveal that Window. The facade now uses itself as the receiver for Object
prototype extensions. Its native Window operations still use captured operations.
The actual-source popup fixture compares both paths on a real child Window;
it does not claim to exercise complete controller admission or confinement.

Existing native methods and newly added metadata are distinct controls. String
operations and other reviewed public replacements may differ from the captured
operations used by trusted callbacks. Implicit hooks such as `then`, iterator and
coercion protocols, plus Error stack formatting hooks, need explicit restrictions
even when ordinary named extensions are supported. Protected globals may accept
identical assignments without accepting a replacement constructor.

## Current evidence

The [final CI run](https://github.com/privacy-frames/host/actions/runs/40763844471)
passed on source `2dfcbc2e8be6d9ec64bc3c20789446b59977e14e`, including 182 unit
tests and the browser context, management, storage, lifecycle and hostile
interception checks. Its [fresh receipt index](../results/evaluation/final-ci-receipts.json)
contains 42 generated receipts and excludes unchanged historical files shipped
in the same artifact.

The [Chromium](../results/network.json) and
[Firefox](../results/network-firefox.json) network receipts identify that exact
source. Both record zero confined receiver TCP connections, STUN UDP datagrams
and private-marker DNS sends. Native controls produced HTTP requests, worker
requests, STUN traffic and DNS sends. These observations cover the calibrated
routes, including worker requests.

The [public asset check](../results/assets.json) verified HTTPS delivery and
matching hashes for 59 files. The host, runtime and installer deployments are
live; their revisions and workflow links are in the [completion audit](COMPLETION.md).
The [public eight-app matrix](../results/evaluation/compatibility-release-public.json)
passed all 16 browser/application task and offline rows on that deployed source.
Separate public tests passed [CyberChef text/file processing](../results/evaluation/cyberchef-text-file-release-public.json)
in both browsers, [Chromium cancellation/SVG](../results/evaluation/cyberchef-cancel-release-public.json)
online and offline, and [Pitch Training](../results/pitch-training-deployed.json).
These tasks verify the selected behavior described in the
[compatibility evaluation](compatibility.md). The [host-interface receipt](../results/deployed.json)
records ten passing behavior/security groups per browser and zero unexpected
errors. Chromium retained one unsupported optional-preparation error, attributed
to its native installer-worker exception; the distinct outcome reason remains
recorded.

The [CI PWA test](../results/compatibility.json) covers Chromium DevTools native
installation and launch of two apps, a full browser restart and offline cold
launch with private state. It does not cover manual installation UI; Firefox did
not perform native installation.

A thrown exception or browser console message alone does not establish that no
request escaped. Receiver observations cover the probe phase as well as later
network attempts. Same-runtime WebSocket controls test a route that
`connect-src 'self'` permits. Popup receiver controls compare guarded and unsafe
forwarding on the same native child Window.

## Historical findings

Earlier review found repeated URL conversion between validation and native calls.
History and resource-attribute wrappers now pass their checked values to the
browser. It also added JSON/JSON-LD data-script admission, controller-replacement
checks and restricted precache lifecycle aliases. These findings and their
receipts describe their recorded revisions, not fresh verification of the current
implementation.

The historical review baseline was
`b4dbf2e6367929cf216d883eaf90a5167e587253`, with evidence under
`results/evaluation/baseline/`. Two attempted delegated adversarial reviews were
rejected before producing findings; those attempts supply no security evidence.

## Limits

Installed apps share a runtime origin. Storage namespaces do not establish
cross-application storage or browser-permission isolation. Native browser UI,
extensions, browser defects, physical side channels and availability are outside
the threat model. General application updates and IFC remain deferred.

Chromium and Firefox desktop receipts do not establish WebKit or real-device
mobile behavior. BFCache, abrupt browser-process loss and every concurrent
replacement schedule remain unmeasured. CyberChef cancellation/restart in Firefox
is unverified where its native control does not complete reliably.
