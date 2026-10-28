# Context startup architecture review

This review began against host revision
`596c0be1e4de35e992a762babc89d489bdfb21f9` and then inspected the context-support
worktree. The architecture review itself runs no browser experiments. Separately
authorized common-policy changes and context-model unit tests are noted
below; broader context support requires its own functional and network evidence.

## Implementation inspected

The controller now binds a dedicated worker during its bootstrap fetch. It derives
application identity from the actual creator client and records the browser's
`resultingClientId`, parent client, kind and bootstrap URL. Ordinary installed
resources cannot start workers: a separate request-destination gate precedes
trusted and resource response shortcuts. Only an owned strict bootstrap path can
reach the later creator/reserved-client checks.

Response policy now defaults worker startup to refusal. Root application and
worker-bootstrap responses allow their owning application's HTTP context
directory and explicitly name the trusted controller script. The latter addresses
a Firefox integration refusal that reported the controlling service worker's
script URL against `worker-src`; the revised managed lifecycle needs a fresh
browser run. The independent request-destination gate still refuses that
controller script as a publisher-created worker. Canonical URL validation rejects
credentials, queries, fragments and header separators. In an isolated test
without a service worker,
both browsers execute an approved-directory native worker and refuse ordinary,
other-directory and Blob workers. Unrestricted controls execute all four cases;
the refused HTTP scripts do not reach the fixture server. This measures CSP
startup behavior independently, not the full managed-worker lifecycle. Evidence:
`test/context-csp.ts` and `results/contexts/csp-startup.json`; three source-validation
unit tests also pass in `test/response-policy.test.ts`.

Bindings use host-owned Cache Storage, outside application cache namespaces.
Known worker fetches resolve by the browser-provided client ID without calling
`clients.get` during synchronous worker imports. This fits a worker's immutable
creation URL. It is deliberately different from window resolution, which also
checks the current URL. The platform receipt in `results/contexts/platform.json`
records actual worker creator/resulting/subsequent-request identifiers in both
browsers; it is platform evidence, not a full confinement test.

The managed nested-worker trace also found requests with empty browser client
identifiers. A dedicated context-resource route handles that case using the
bootstrap-issued context identifier as a bearer. It grants reads of that
context's immutable installed graph and readiness synchronization. Any nonempty
caller ID must match the actual bound worker. Ordinary application URLs provide
no such grant; management, storage, closure and creation of another context still
require their independent checks. Publisher code may observe its resource
capability, so it is intentionally delegable within that limited scope.

Six resource-route unit tests in `test/context-resources.test.ts` cover foreign
paths and callers, unknown resources, context-start destinations, methods,
navigation, queries, revoked or incompatible bindings, and concurrent/replayed
readiness. Each stored installation receives a fresh host-generated UUID;
downloaded metadata cannot choose it. Each capability is bound to that generation, so
replacing the same application identity revokes its old graph and readiness
routes. Checked graph reads compare the generation and read the bytes in one
IndexedDB transaction. Previously installed records without a generation require
reinstallation before they can start children. Readiness updates are serialized
and idempotent. Their state is
bookkeeping, not evidence that publisher code or its setup is trustworthy.

Firefox uses request destination `worker` for a descendant module import. That
resource case is admitted only for the exact existing browser worker client with
an explicitly empty resulting-client ID and JavaScript content type. A new
reserved client, an absent caller or another destination still fails. The unit
fixtures distinguish the observed module request from native construction;
`results/contexts/worker-destinations.json` records the separate browser platform
comparison. The managed suite must exercise both paths through the controller.

`CONTEXT_POLICY_VERSION` is now part of controller records, bind/resolve checks
and stored-data parsing. Seven unit tests in `test/context-model.test.ts` pass:
persistent bindings survive a registry replacement; closed bindings cannot
regain authority; incompatible policy versions cannot bind or resolve. Closure
tests cover actual-parent/application checks, cancellation before binding,
concurrent readiness and late writes from a replaced controller. Worker
bootstrap validation must check the same version before admitting payloads.

The controller accepts closure through an owned context endpoint authenticated by
the actual parent browser client and application. A private context-ID index
locates the worker binding. Owner-scoped cancellation records cover termination
before the bootstrap binds; durable closed markers prevent a delayed readiness
write from restoring authority. These are controller and unit-test results.
Factory integration still needs its lifecycle controls in the managed browser
suite.

The worker bootstrap captures native event-data, event-port and messaging
operations, validates controller-supplied metadata, removes its temporary global,
then installs SES, resource/effect policies, scoped storage and descendant creation
before loading publisher code. Module payloads are dynamically imported after
setup; their static dependencies consequently evaluate in an already prepared
realm. Parent startup uses a private port; publisher messages do not select
management roles.

The factory captures native construction and MessageChannel accessors and patches
the native Worker prototype's constructor. Its queue clones at the original
`postMessage` call, preserving immediate transfer of the caller's buffer rather
than deferring that detachment until startup. This source structure needs the
functional controls described below; inspecting it does not establish every
structured-clone edge case.

The root document still requires a top-level/no-opener environment, and response
policy still forbids frames and objects. Window/SVG/popup/shared-worker/worklet
adapters are not implemented merely because their names appear in the context
model. Current worker tests do not establish those later stages.

## Open implementation questions

- The worker bootstrap announces readiness after awaiting module import, while
  the parent retains application messages until readiness. A module waiting for
  its first message during top-level await needs a native comparison: the extra
  gate could otherwise prevent the message that finishes initialization.
- Pre-ready `postMessage` converts arguments through a custom clone path. Compare
  missing arguments, null options, iterable transfer lists and errors with the
  native path, including its post-ready behavior. These are compatibility
  questions; no disclosure is asserted through them.
- Parent termination and startup failure need browser integration checks against
  the controller closure endpoint. Abrupt worker self-closure or process failure
  has no measured registry cleanup mechanism. Child cleanup after native
  termination cannot be assumed to run.
- Blob source admission checks runtime origin. It does not establish a separate
  per-application object-URL provenance registry. Describe the current accepted
  source as a runtime-origin Blob rather than asserting stronger ownership.
- The destination gate is an independent backstop for context destinations
  delivered to the host fetch handler. Native publisher service-worker
  registration must remain blocked separately; its script-update requests are
  not all ordinary controlled fetches. Each worklet adapter must verify the
  browser's actual request classification before relying on that gate.

## Shared contract

A context belongs to one installed application and receives its resource and
storage namespace. It receives no manager role. The runtime owns creation,
startup, readiness and subsequent document replacement. Contexts must establish
restrictions before executing publisher code or exposing an unprepared realm to
publisher code in another context.

Keep native capture and descriptor protection in a shared layer. Separate effect
policy and storage scoping from document parsing, navigation and UI APIs. Worker
adapters should expose worker APIs; they need not simulate window APIs that the
browser does not provide there.

A private registry should bind actual browser client IDs to full application ID,
context kind, parent context, policy version and lifecycle state. A URL alias or a
message's claimed application ID cannot create that binding. Persist the records
needed across host service-worker restarts in host-owned storage, and recheck the
actual client before using a record. Application storage wrappers must not expose
that store. Keep context registration separate from the existing manager-role
protocol.

## Dedicated workers

Returning a native worker handle synchronously is compatible with asynchronous
startup if the worker initially runs only a trusted bootstrap. The application
payload starts after policy and identity are ready. A private control port can
carry bootstrap messages without mixing them into the application's message
channel. Preserve native structured-clone and transferable-object behavior at the
original `postMessage` call; a JavaScript queue that clones later changes buffer
detachment and error timing.

Use a runtime HTTP bootstrap route even when the publisher supplies Blob source.
The factory can capture that source as data and select classic/module startup,
while the browser starts only the trusted bootstrap. Guard setup must precede
publisher module evaluation; merely prefixing a module's text does not precede
its static dependency evaluation. A guarded bootstrap followed by controlled
application loading avoids that ordering mistake.

The HTML worker processing model sets the top-level script request's reserved
client to the new worker environment. A service-worker fetch event exposes its
initiating client and reserved/resulting client identifiers. This supports
validating the real creator and binding the resulting worker before returning the
bootstrap response. Confirm the actual identifiers and control behavior in both
browsers before depending on this path. [Worker processing](https://html.spec.whatwg.org/multipage/workers.html#worker-processing-model),
[fetch-event identifiers](https://w3c.github.io/ServiceWorker/#fetch-event-resultingclientid)

Workers obtain a policy container through their startup response. Do not assume
that the parent document's response headers establish every worker restriction.
Subsequent worker requests should resolve ownership through the private client
binding. Nested workers use the same factory and registry protocol.
[Worker policy initialization](https://html.spec.whatwg.org/multipage/workers.html#worker-processing-model)

Audit references returned by constructors and events as well as globals. For
example, a returned worker's prototype constructor must not expose an unmediated
creation path. The same principle applies to nested workers and shared-worker
ports. This is a reference-ownership requirement, not a reason to replace native
message serialization with a generic object proxy.

## Child documents

The current guard's external parser-blocking script protects publisher scripts
inside its final document, but its first condition rejects every parent/opener.
It is not a child-document startup adapter. Simply removing that condition and
allowing frames would leave the creation interval unaddressed.

An iframe initially has an `about:blank` document, and the initial insertion path
can fire its load event. Gating `contentWindow` and `contentDocument` alone does
not mediate every parent reference: `window.frames`, indexed windows and named
references can also expose the child. An asynchronous external guard leaves an
interval in which that realm has not installed its restrictions.
[Iframe processing](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#the-iframe-element)

One candidate for transparent same-origin children is synchronous trusted setup
of the initial document before its insertion wrapper returns. A fixed inline
bootstrap authorized by a CSP hash could perform realm setup synchronously;
trusted setup would capture its own source for descendants. This needs specific
browser validation. Capture-phase handling must withhold initial load callbacks
until setup finishes, and custom-element or other synchronous reentrancy must
not expose the realm first. The existing custom-element restrictions help, but
are not evidence that the whole creation path is covered.
[CSP hash matching](https://www.w3.org/TR/CSP3/#matching-hash-source)

After setup, keep the guarded realm and render admitted child content into it.
Native navigation replaces the realm, so it must either repeat the full protected
startup or remain canceled while the host performs a mediated content load. The
existing child navigation, location, source setters, document replacement and
reload paths all need an explicit decision. Supporting a guarded initial
`about:blank` alone does not establish later navigation safety.

An alternative is a cross-origin child with message-only access. That provides a
browser boundary during startup, but changes same-origin DOM interaction. An
opaque sandbox also loses normal service-worker control and storage access;
therefore it cannot inherit the existing HTTP gate without additional routing.
These are architecture alternatives, not interchangeable implementations.
[Service-worker client control](https://w3c.github.io/ServiceWorker/#control-and-use)

For SVG, a guarded HTML child containing SVG can reuse document setup, but it is
an explicit rendering adaptation. Its document root and object interfaces differ
from a native standalone SVG document. CyberChef's actual SVG uses local rotor
queries and geometry, so it is a useful compatibility case; its success would
not establish native SVG-document equivalence.

## Other adapters

Popups need the same synchronous initial-realm treatment. Existing named windows
must be resolved within the owning application's context tree; a publisher name
must not select the manager or another application's window. A child may have an
owning application window as opener only after that relationship is established.
External embedding and external opener access should remain refused.

Shared workers need application-scoped identity in both URL and name, with each
connecting port authorized for the same application. They can outlive one parent,
so their confinement must not depend on parent liveness. Worklets require their
own bootstrap and import-order analysis; their script loading and available APIs
differ from dedicated workers.

Publisher service workers cannot replace the native host controller. Their
supported lifecycle or fetch behavior can run behind host mediation, with the
host retaining final control over network access, executable responses and the
bootstrap for every resulting document or worker.

## Acceptance evidence

For each enabled adapter, measure ordinary behavior and initialization order,
identity/storage separation, message and transfer semantics, descendants,
termination/replacement and host-worker restart. Independent network observations
need active unrestricted controls. Test reference availability during creation,
not only after load. Record expected API timing differences when mediation
changes them. Leave an adapter disabled until its startup paths are covered;
passing one application's task is functional evidence for that task, not proof
that all creation paths preserve confinement.

This review inspected `guard.ts`, `worker.ts`, `response-policy.ts`,
`enforcement/native.ts`, `enforcement/effects.ts` and `storage/indexed-db.ts`, plus
the cited HTML, CSP and service-worker specifications. No context implementation
or security claim was verified by executing it.

## Child-document platform experiment

`test/document-platform.ts` ran in Chromium153.0.8010.12 and Firefox155.0.
The unrestricted initial about:blank control exposed its native realm. A first
experiment relying on a Window load capture failed: the application load listener
and a script later in the same batch insertion ran before preparation. That
receipt is retained as `results/contexts/document-platform-initial.json`.

Registering trusted capture on the Document and on the managed frame before
returning its element made the inline nonce bootstrap run first in both browsers.
The later batch-inserted script observed the preparation marker, and the app's
initial load callback was suppressed. Both browsers also expose `moveBefore`.
The current receipt is `results/contexts/document-platform.json`.

This establishes event ordering for the measured cases, not full child-context
confinement. The actual adapter still needs shared realm enforcement, load-event
resumption, safe content rendering, reference checks, replacement/navigation
handling and nested cases. It must cover batch insertion and reentrancy rather
than relying on a Promise or the contentWindow getter alone.

## Document adapter hooks after the first-commit experiments

The newer platform experiments change the candidate lifecycle. Set the owned
HTTP `src` before insertion, prepare the initial child realm synchronously, and
retain that prepared realm through its first trusted commit. The parent reports
retention in Chromium (8 runs) and Firefox (40 runs) when native controller
coverage and a preinstalled navigation handler are present. Blank-only creation
followed by renavigation exposed an unprepared realm in 3 of 40 Firefox runs.
These counts describe the platform experiments; they do not establish coverage
of every insertion or parser API. The adapter should follow the first lifecycle
and keep later document replacement disabled.

A batch insertion can execute an inline script while the native insertion call
is still running. A wrapper that prepares frames only after native insertion
returns leaves a gap. The script-policy `beforeExecute` trampoline addresses that
ordering for inline classic scripts, with the original directive prologue kept
first. It must flush pending child preparation before publisher statements run.
Invalid scripts retain their native syntax failure. Data scripts need no
trampoline; modules and external scripts need their own execution-order checks.
A DOM mutation observer runs too late to supply this boundary.

The current DOM policy still rejects context elements and their references.
Admitting a tag requires the following hooks together:

- Creation and insertion: `createElement`, `createElementNS`, the existing
  `appendChild`/`insertBefore`/`replaceChild`, ParentNode and ChildNode operations,
  `insertAdjacentElement`, and Range insertion. Feature-detect `moveBefore` on
  the ParentNode implementations that provide it. A state-preserving move should
  keep its existing prepared context rather than mint another one. Inspect nested
  fragments and template contents. Capture native getters for traversal and
  element classification.
- Parsing: `innerHTML`, `outerHTML`, `insertAdjacentHTML`, and any parser that is
  later admitted. The current Range fragment, DOMParser, Document parsing and
  DocumentImplementation entry points remain denied. Frame-bearing markup must
  receive an owned startup URL before an active parser can create its context.
  Validate or construct it in an inert representation first. Post-parse scanning
  alone cannot cover synchronous load callbacks or inline script execution.
- Copying and transfer: deep `cloneNode`, `importNode`, `adoptNode`, template
  cloning and Range extraction/cloning. A copied element must obtain fresh
  private lifecycle state when activated; its copied host URL is not authority to
  reuse the original context. Adoption and state-preserving moves need explicit
  rules for existing windows and their retained references. Reject a transfer
  the adapter cannot classify before activation.
- Attribute changes: frame reflected properties, `setAttribute`/`NS`,
  `setAttributeNode`/`NS`, `toggleAttribute`, `Attr.value`, `Attr.nodeValue` and
  `Attr.textContent`. The current sensitive-Attr check covers policy/script
  elements, not newly admitted frames. Read the native Attr name, namespace and
  owner getters; publisher-visible property lookups cannot classify a native
  attribute securely. Include removal through `removeAttribute`/`NS`,
  `removeAttributeNode`, and `NamedNodeMap.removeNamedItem`/`NS`. Removing `src`
  or changing `srcdoc` can start a different document. Frame `sandbox` exposes a
  mutable DOMTokenList, so protecting its reflected setter alone is insufficient.
- Execution and events: flush pending preparation before each supported script
  execution path and before exposing a child reference. Install the parent's
  native capture listeners before publisher listeners exist. A synchronous load
  callback during insertion must observe a prepared child or be withheld; a
  later listener cannot repair that ordering. Keep navigation cancellation in
  every child, with only its single owned first commit admitted. Do not depend on
  load handlers to establish confidentiality after publisher code can run.
- Removal and replacement: `removeChild`, `remove`, `replaceChild`,
  `replaceChildren`, Range deletion/extraction, and string-based replacement can
  detach an entire subtree. Revoke its resource capability and controller record
  through the actual parent. Existing references to an old Window must remain
  confined after detachment. Closing bookkeeping cannot remove an already
  exposed native reference or undo code that ran before preparation.

Named and indexed Window properties are another reason to enforce preparation at
activation. `window.frames`, numeric indexing, named windows, form/link targets,
`parent`, `top` and `opener` do not all pass through frame-element
`contentWindow`/`contentDocument` getters. Those getters are useful checks but
cannot define the security boundary. Keep popups, objects and embeds disabled
until their own creation and reference paths are implemented.

Cross-realm calls also need receiver-based dispatch. Publisher code in a prepared
child can call its DOM methods on a parent's nodes, and vice versa. A wrapper
must select the private document policy from the actual native `ownerDocument`
(or Document receiver), rather than assume its defining realm owns the target.
Otherwise it can queue a pending child in one policy while another policy's
script trampoline flushes a different queue. If that dispatch is unavailable,
refuse the affected cross-document operation before mutation.

A small explicit interface can keep document handling out of the generic DOM
wrapper:

```ts
interface DocumentContextPolicy {
  isContextElement(node: unknown): node is Element;
  prepare(element: Element): void;
  attribute(element: Element, name: string, value: string | null): string | null;
  settle(): void;
}
```

`prepare` assigns the owned startup route and records the pending lifecycle before
activation. `attribute` validates normalized attribute updates and removals before
native mutation. `settle` synchronously prepares newly created initial realms;
call it after every supported mutation, including partial mutations before a
native exception, and from the script execution hook. The adapter owns its
captured native frame accessors, per-document dispatch, pending contexts,
first-commit allowance and cleanup. Shared DOM policy retains parser validation,
traversal and insertion wrapping. Unsupported context kinds still fail at the
adapter boundary. This interface is a proposal; it does not implement the hooks
listed above.

Native SVG documents need a separate parser and execution review even if the
Window-retention experiment succeeds. Their document shape, SVG script elements,
foreignObject descendants and load order differ from the HTML bootstrap. Sharing
window effects, storage and context ownership is useful; treating HTML parsing or
an HTMLScriptElement check as coverage of native SVG startup would overstate the
current implementation.

### Foreground publisher-worker profile (implementation under validation)

A publisher service worker must not become the native controller. The host's
native worker continues to authenticate browser clients, serve context guards,
and enforce graph-only resource access. A separate prepared SharedWorker runs
publisher install, activate, message, and eligible fetch handlers. Its native
connection port is transferred directly from trusted Window setup to the host;
application messages use a nested payload and do not become host commands.

The role registry records application, installation generation, current native
SharedWorker client, fresh context identity, and one-use connection grants in
host-private IndexedDB. A native-controller restart can request a new connection
through an authenticated application Window. An active profile with no ready
executor fails closed while that connection is restored. The source worker's
own graph requests bypass its publisher fetch handler, avoiding recursion.

This profile handles GET requests for admitted non-executable resources. Scripts,
documents, context creation, guards, management, and host protocol routes stay
outside the publisher handler. Requests omit origin-wide Cookie and Authorization
headers. Handler rejection, redirects, executable response types, and malformed
results fail closed; absence of respondWith selects the captured graph response.
Response headers cannot replace host policies, set cookies, redirect, or grant
additional cross-origin access. The host applies its response policy again.

The implemented API supports one registration per application generation and
foreground execution while an application Window is available. Background push,
updates, navigation preload, native publisher registration, and publisher
clients.openWindow are outside this profile. SharedWorker API absence must be
reported as unavailable, not counted as successful support. This is an explicit
compatibility profile rather than native service-worker equivalence.

Independent tests currently establish the native Window → controller →
SharedWorker port bridge in both browsers, role-store transaction behavior in
both browsers, and event-kernel request/response handling in unit tests. The full
installed-runtime fixture is authored but has not yet run; integration and
controller-restart behavior therefore remain unverified.

Cache URL normalization is shared by Window and worker realms: relative inputs
resolve against the logical publisher execution base and known runtime aliases
use original resource URLs as keys. CacheStorage.match still searches only the
application namespace. The independent two-realm matrix passes in Chromium and
Firefox, including query and fragment handling and rejection of unknown
Cache.add sources before fetching. Cache.addAll retains the existing sequential
storage behavior after all downloads succeed; native atomic batch semantics are
not established by this adapter.
