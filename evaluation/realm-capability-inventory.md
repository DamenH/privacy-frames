# Realm capability inventory

This inventory describes the Milestone 1 research adapters, not the deployed
runtime. The current adapters do not establish a confined browser environment.
Presence checks report JavaScript value types; they do not establish that an API
works, that a reference grants additional authority, or that communication occurs.

## Recorded global profiles

[Adapter receipts](../results/realms/adapters.json) cover Chromium
153.0.8010.12 with native ShadowRealm, ordinary Chromium with Near Membrane, and
Firefox 155.0 with Near Membrane. The native mode uses
`--js-flags=--harmony-shadow-realm`.

| Global                                     | Native Chromium | Chromium fallback | Firefox fallback | Required owner                                                          |
| ------------------------------------------ | --------------- | ----------------- | ---------------- | ----------------------------------------------------------------------- |
| `document`, `window`, `location`, `parent` | undefined       | object            | object           | Window bootstrap and shared DOM/navigation bridge                       |
| `opener`                                   | undefined       | object            | object           | Window lifecycle bridge; `typeof null` is also object                   |
| `fetch`                                    | undefined       | function          | function         | Resource bridge and host service worker                                 |
| `Worker`                                   | undefined       | undefined         | function         | Context controller and worker resource policy                           |
| `WebSocket`, `RTCPeerConnection`           | undefined       | undefined         | function         | Transport policy; not granted by the current bridge                     |
| `WebAssembly`                              | object          | object            | object           | Data/computation profile; compilation needs separate qualification      |
| `structuredClone`                          | function        | function          | function         | Value conversion and transfer profile; presence is not transfer support |

Both fallback browsers expose a non-configurable accessor for `document`.
An empty Near Membrane `globalObjectShape` therefore does not create the native
profile. The adapter's host-function distortion also does not, by itself,
classify or remove the detached realm's own browser interfaces.

## Proposed initialization

A proposed guest initialization helper would run before publisher execution and
before returning application-facing references. It would inventory the guest's
own and inherited global descriptors, retain an explicit language/data profile,
and replace configurable ambient browser globals. Shared bridge bootstrap would
then install the reviewed browser facades. Unknown browser APIs would remain
unavailable until assigned an operation policy.

The retained language profile includes Object, Function, Array, typed arrays,
Map/Set and their weak variants, JSON, Promise, Reflect, Proxy, errors, strings,
numbers, Math, Date and Intl. Their guest intrinsics must remain independent of
trusted code. URL parsing, text codecs, base64 conversion and structured cloning
need individual data-profile decisions; they are not automatically safe or usable
because they have familiar names.

The helper cannot replace non-configurable accessors. Document, Window and
Location require an explicit account of their remaining native members and the
lifecycle of the detached frame. The DOM experiment's facade prototype does not
establish that all native members have been removed. These remain qualification
obligations, not completed initialization steps. No production entry point calls
a proposed helper.

## Interface ownership and current support

| Interface family                              | Research support                                                          | Policy and implementation owner                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| DOM creation, identity and synchronous layout | Shared bridge demonstrated on both adapters                               | Trusted rendering document; guest handle/facade conversion                                                            |
| Events and synchronous default cancellation   | Real checkbox cancellation demonstrated                                   | Trusted event dispatch and guest callback bridge                                                                      |
| Markup, styles and native default actions     | Replacement profile unresolved                                            | Document compiler, browser policies and controller; JavaScript isolation does not mediate these effects automatically |
| JSON, maps, promises and cyclic data          | Language support and selected conversion probes                           | Guest intrinsics and shared value protocol                                                                            |
| Image-sized buffers and transfers             | Copying experiments exist; native engine limitations remain               | Shared buffer protocol plus actual native browser/worker operations                                                   |
| Fetch, XHR and resource loading               | Production admitted-resource policy exists; replacement bridge incomplete | Host service worker and resource capability bridge; no network fallback                                               |
| Storage and browser permissions               | Replacement profile incomplete                                            | Storage facade/context identity; browser permission policy remains origin scoped                                      |
| Dedicated/shared workers                      | Native execution must be retained; replacement profile unresolved         | Context controller, worker bootstrap and remaining worker-local policy                                                |
| Worklets                                      | Native execution must be retained; replacement profile unresolved         | Worklet loader, owning application and worklet-local capability inventory                                             |
| Publisher service-worker behavior             | Existing prepared executor remains the baseline                           | Publisher controller; application code does not acquire native controller authority                                   |
| Local exports                                 | Existing compatibility gap                                                | Export capability with a real saved-file test before support is claimed                                               |

## Module containment checkpoint

The [isolated loading receipt](../results/realms/loading-spike-isolated.json)
records the same guest-local SystemJS linker on both adapters with COOP/COEP
headers. Host source and resolution hooks exchange strings. Module namespaces,
object exports, live bindings, cycles, top-level await and transformed dynamic
imports remain inside the guest.

An exported function in the compiled module reports its own globals and intrinsic
markers. In native mode it sees neither document/fetch nor host secret/Array
markers, and it sees the guest markers. The fallback module sees the guest markers
and no host markers, but still reports document/fetch present. Module execution in
the guest is demonstrated; fallback authority qualification remains open.

The linker source is 25,321 bytes. TypeScript 6.0.3 compiles fixtures in Node only;
its 9,144,216-byte compiler is not a proposed shipped implementation. Production
compiler cost and exact classic-script lexical behavior remain unresolved. Direct
native module-loading crashes have separate receipts, including the installed
full Chromium binary and additional flag experiment; those failures do not
invalidate the independently demonstrated shared linker path.
