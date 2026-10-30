# Model-to-implementation mapping

This mapping describes the verification worktree, including the live-phase
bookkeeping simplification documented below. Individual receipts pin the exact
source and artifact hashes they checked. Line links are navigation aids, not a
claim that the TLA+ actions are generated from TypeScript. A narrow Registry trace
comparison exists; there is no refinement relation for the combined runtime and
browser boundary.

## Meaning of the modeled states

`Lifecycle.Prepare` means that the local execution environment has installed
its restrictions. It does not mean that the controller's ContextIdentity has a
particular live phase label. Those serialized labels remain valid for normal
controller updates, but readiness and content delivery no longer advance them.
The controller now revalidates effective identity/capability after asynchronous
work without writing diagnostic phase transitions
([model.ts](../src/runtime/contexts/model.ts)). The local guard still prepares the
realm before application execution and publication.

`Publish` concerns access to execution authority, not every returned JavaScript
handle. The worker factory returns a native Worker handle before its ready
message, but intercepts message delivery and supports termination
([worker-factory.ts:145](../src/runtime/contexts/worker-factory.ts#L145),
[worker-factory.ts:225](../src/runtime/contexts/worker-factory.ts#L225)). Popups
initially return a facade
([popup-factory.ts:148](../src/runtime/contexts/popup-factory.ts#L148)). Neither
case is equivalent to exposing an unrestricted Window or WorkerGlobalScope.

## Lifecycle correspondence

| Model action or invariant      | Concrete mechanism                                                                                                                                                                                                                                                                                                                                                                     | Correspondence limit                                                                                                                                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CreateRoot`                   | A document navigation binds `event.resultingClientId` to a new root identity and serves a trusted shell, [worker.ts:480](../src/runtime/worker.ts#L480).                                                                                                                                                                                                                               | URL parsing identifies an installation, while the browser client binding supplies authority. These are separate steps.                                                                                                                   |
| `CreateChild(c,p)`             | Child document intents derive their owner from `event.clientId`, [document-controller.ts:40](../src/runtime/contexts/document-controller.ts#L40), and bind the reserved navigation client, [document-controller.ts:177](../src/runtime/contexts/document-controller.ts#L177). Dedicated workers bind the browser's resulting client at [worker.ts:419](../src/runtime/worker.ts#L419). | The model has one generic child action. Documents, dedicated workers, shared workers and worklets have different startup protocols.                                                                                                      |
| `Prepare(c)` for windows       | `prepareWindowRealm` installs intrinsic, resource, script, context, navigation, DOM, effect and storage policies before sealing bindings, [window-realm.ts:38](../src/runtime/contexts/window-realm.ts#L38). Root rendering follows preparation, [guard.ts:56](../src/runtime/guard.ts#L56).                                                                                           | A single action abstracts many calls that can fail and native effects that must remain unavailable during setup.                                                                                                                         |
| `Prepare(c)` for workers       | `prepareWorkerRealm` runs before the first bootstrap message can request publisher loading, [worker-guard.ts:15](../src/runtime/contexts/worker-guard.ts#L15). It installs effects and storage restrictions, [worker-realm.ts:138](../src/runtime/contexts/worker-realm.ts#L138).                                                                                                      | The real worker exists before publisher code runs. Native bootstrap execution is distinct from application execution.                                                                                                                    |
| `PublishedIsPrepared`          | Child guard reports completion only after local preparation and private compilation, [document-guard.ts:125](../src/runtime/contexts/document-guard.ts#L125). Parent checks source Window, origin, context ID and parent token, [document-factory.ts:517](../src/runtime/contexts/document-factory.ts#L517).                                                                           | The model assumes those checks establish the intended child. It does not model WindowProxy identity, event dispatch or token transport.                                                                                                  |
| Child publication              | `publish` uses state-preserving movement and checks that Window and Document identities survive, [document-factory.ts:468](../src/runtime/contexts/document-factory.ts#L468). `reference` returns null until the prepared, connected identities match, [document-factory.ts:696](../src/runtime/contexts/document-factory.ts#L696).                                                    | Closed shadow roots and getter interception are concrete mechanisms, not consequences of a TLA+ phase label. Indexed/named access and alternate reference paths need browser tests.                                                      |
| `Run(c)` / `NoUnsafeExecution` | Child rendering waits for the parent publication acknowledgement, [document-guard.ts:157](../src/runtime/contexts/document-guard.ts#L157), then runs at [document-guard.ts:212](../src/runtime/contexts/document-guard.ts#L212). Worker loading validates source/base and only then imports or executes it, [worker-realm.ts:290](../src/runtime/contexts/worker-realm.ts#L290).       | Worker `ready`, application listener installation and complete module evaluation are different events. Top-level await can separate them.                                                                                                |
| Parent/child startup ordering  | Child startup acknowledgements and load events pass through generation-checked deferred actions, [document-factory.ts:157](../src/runtime/contexts/document-factory.ts#L157). Parent classics run before release, [document-renderer.ts:549](../src/runtime/contexts/document-renderer.ts#L549).                                                                                       | Lifecycle now permits child creation while its parent is published but has not run. The `NoChildBeforeParentRun` reachability control exercises that interleaving; actual parent-classic ordering remains a separate browser obligation. |
| `Replace` / `CurrentOwners`    | Installations get fresh generations, [storage.ts:88](../src/runtime/storage.ts#L88). Resource reads check the expected generation, [storage.ts:48](../src/runtime/storage.ts#L48), and controller identity resolution compares it with the installed generation, [worker.ts:159](../src/runtime/worker.ts#L159).                                                                       | Atomic model replacement is an abstraction. Real storage writes, pending requests and browser-context termination are not one atomic operation. `CurrentOwners` checks epoch freshness, not every parent-ownership decision.             |
| `NoStaleAcceptance`            | Document intents and content consumption compare installation generation, [document-controller.ts:166](../src/runtime/contexts/document-controller.ts#L166); publisher executor lookup does the same, [publisher/controller.ts:103](../src/runtime/publisher/controller.ts#L103).                                                                                                      | There is no universal generation field on every real message. Management commands and context RPC have different validation. Model `Accept` must not be read as their shared implementation.                                             |

The original `Confinement` sketch also names `PreparedBeforeRun` and
`PreparedBeforePublication`. Its historical `ran` set and current phase coincide
only because that sketch has no close action. Adding closure must preserve the
fact that a past execution was prepared without requiring its context to remain
published forever. The newer Lifecycle model records unsafe execution separately.

## Admission and resource delivery

| Model action or invariant         | Concrete mechanism                                                                                                                                                                                                                                                                                     | Correspondence limit                                                                                                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Begin`, `Verify(r)`              | Installation downloads declared resources and parses source data through [import-website.ts:37](../src/installation/import-website.ts#L37). Runtime admission independently validates format, identity, paths, bytes, hashes and capture metadata, [admission.ts:82](../src/runtime/admission.ts#L82). | A model resource is an atom. Actual URLs, MIME types, fragments, canonical paths, rewritten bytes and hash computations are not modeled.                                                                                     |
| `Commit`, `NoUnverifiedAdmission` | The authorized management handler calls `admitInstallation` before `putApp`, [worker.ts:193](../src/runtime/worker.ts#L193). Metadata and resource bodies are written in the storage transaction, [storage.ts:77](../src/runtime/storage.ts#L77).                                                      | Model Commit accepts any nonempty verified subset. It does not express completion of every required explicit-list URL or failure of a required download.                                                                     |
| `NoUnauthorizedCommit`            | A management message must resolve its actual source client, match the management URL and have a controller-issued management role, [worker.ts:178](../src/runtime/worker.ts#L178). Roles are granted on trusted management navigation, [worker.ts:348](../src/runtime/worker.ts#L348).                 | `ForgedInstall = FALSE` assumes these mechanisms hold. A caller-supplied role or URL is not the implementation's authentication mechanism.                                                                                   |
| `NoApplicationDuringInstall`      | The installer collects source and validates prepared documents; publisher worker lifecycle execution is deferred to runtime registration.                                                                                                                                                              | Trusted installer and host bootstrap downloads are permitted setup traffic. The model's remote flag must concern forbidden application traffic, not all network activity in every phase.                                     |
| `Request(r)`, `NoRemoteTraffic`   | The fetch handler resolves the owning installation, matches an admitted resource, and reads its stored bytes, [worker.ts:537](../src/runtime/worker.ts#L537). Unmatched requests and handler failures return `Response.error()`, [worker.ts:580](../src/runtime/worker.ts#L580).                       | This maps controlled fetch delivery. It does not enumerate WebSocket, WebRTC, navigation, browser services or every native default action.                                                                                   |
| Worker resource reads             | `contextResourceResponse` checks request shape, context capability, generation, destination and exact resource path, [resources.ts:65](../src/runtime/contexts/resources.ts#L65).                                                                                                                      | An empty browser caller ID may use the context bearer for immutable graph reads, [model.ts:117](../src/runtime/contexts/model.ts#L117). That limited capability does not establish browser identity or management authority. |
| `WritePrivate`                    | Application storage wrappers namespace data. Installation replacement writes the new metadata database without deleting app-private storage.                                                                                                                                                           | `stored` is a reachability flag, not an information-flow label or a proof of storage isolation. The prototype does not promise separate browser permissions or origins per installation.                                     |

`NoStoredPrivate`, `NoRunningChild`, `NoReplacement` and `NoChildBeforeParentRun` are deliberately violated
reachability checks in their corresponding configurations. They demonstrate that
useful actions can occur; they are not security requirements of the host.

## Worker and publisher authorization

Raw worker, shared-worker, worklet and service-worker startup destinations are
rejected unless their dedicated controller route handles them
([worker.ts:269](../src/runtime/worker.ts#L269)). Dedicated-worker bootstrap requires
an authenticated parent and a reserved resulting client. Shared-worker bootstrap
has its own owner and browser-binding checks
([shared-controller.ts:69](../src/runtime/contexts/shared-controller.ts#L69));
connection tickets are consumed against the actual application actor
([shared-connections.ts:200](../src/runtime/contexts/shared-connections.ts#L200)).
Worklet requests retain the owning Window client and reject a newly resulting
client ([worklet-controller.ts:70](../src/runtime/contexts/worklet-controller.ts#L70)).
These are different authorities, despite sharing an abstract context label.

The trusted host service worker is distinct from publisher service-worker
behavior. Publisher registration accepts only captured executable resources and
validated scope/type metadata
([publisher/controller.ts:346](../src/runtime/publisher/controller.ts#L346)). Its
executor is a prepared shared worker, not a native service worker with controller
authority. Registration, executor bindings and expiring grants live in
transactional storage; ticket consumption checks the current binding
([publisher/store.ts:239](../src/runtime/publisher/store.ts#L239)). Install/activate
completion is recorded only after executor startup
([publisher/guard.ts:202](../src/runtime/publisher/guard.ts#L202),
[publisher/store.ts:156](../src/runtime/publisher/store.ts#L156)).

Publisher interception can change an already-admitted non-executable response;
it does not expand the resource graph. Invalid, redirected or executable
representations are refused
([publisher/controller.ts:639](../src/runtime/publisher/controller.ts#L639)). A
typed executor-lifecycle failure may return the original admitted response after
rechecking generation and ownership
([publisher/controller.ts:688](../src/runtime/publisher/controller.ts#L688)). That
local fallback is not the modeled `NetworkFallback` fault.

`NoForgedAuthority` therefore covers several concrete boundaries: management
roles, parent ownership, context identity, tickets and executor bindings. The
current boolean leakage switch does not prove that no unrestricted browser
reference or control callable can cross application callbacks, errors or proxies.

## Revocation and durable-state gaps

The real registry serializes its own mutations
([model.ts:49](../src/runtime/contexts/model.ts#L49)). `closeChild` checks parent,
application and context, records cancellation before a possible delayed bind, and
rechecks a racing binding
([model.ts:170](../src/runtime/contexts/model.ts#L170)). The controller store keeps
closure markers separately so a later record write cannot resurrect that client
([controller-store.ts:88](../src/runtime/contexts/controller-store.ts#L88)).
Document cancellation also increments a local generation and closes its protocol
state ([document-factory.ts:261](../src/runtime/contexts/document-factory.ts#L261)).

Lifecycle currently models installation replacement as atomic revocation. It does
not model these separate durable writes, controller restart, child cancellation,
queued callbacks or native termination. `closeChild` itself does not recursively
traverse descendants. Worker descendant termination and orphan Window behavior
must be stated per browser/context profile rather than inferred from that method.

The separate [generation read model](confinement/generation-reads.md) models an
IndexedDB snapshot and delivery after replacement, and links it to observed
browser overlap tests. It does not yet compose with Lifecycle's revocation rule.

## Browser obligations and evidence

The source relies on browser-assigned client IDs, request destinations and
resulting-client IDs; origin/source information on messages; service-worker
control of the relevant fetches; CSP and response sandbox enforcement; native
DOM identity; and state-preserving context movement. Child bootstrap checks its
actual controlling script
([document-guard.ts:92](../src/runtime/contexts/document-guard.ts#L92)). Response
policy adds CSP restrictions
([response-policy.ts:47](../src/runtime/response-policy.ts#L47)); its optional
Connection-Allowlist header is supplemental and cannot supply the same assurance
in browsers that do not implement it. Other browser transports need the local
effect policy and independent behavioral evidence.

Relevant existing fixtures include the registry race and restart cases in
[context-model.test.ts:51](../test/context-model.test.ts#L51), admission checks in
[runtime-admission.test.ts:8](../test/runtime-admission.test.ts#L8), publisher
response cases in
[publisher-events.test.ts:71](../test/publisher-events.test.ts#L71), and the actual
browser document/worker/publisher suites. This mapping task did not run those
tests. The Registry comparison below concerns a separate, narrowly defined trace
projection.

## Narrow Registry implementation conformance

[Registry.tla](confinement/Registry.tla) separates one context's effective binding
state from owner/other closure requests. `Bind` maps to `ContextRegistry.bind`;
`Revalidate` abstracts `isCurrent` and `isCapabilityCurrent`; owner/other close
actions map to `closeChild`. The current implementation no longer writes live
phase transitions. Persisted `preparing`, `ready` and `running` labels all project
to `bound`; they neither grant authority nor establish guard preparation. A
closed effective record is unavailable. `ReviveClosed` injects acceptance of a
closed binding, rather than an obsolete phase rewrite. The invariants exclude
binding after an owner close request, accepting closed authority and closing an
existing identity on behalf of another parent.

The [trace test](confinement/registry-trace-test.ts) enumerates all 10,000
length-four sequences over ten operations against actual ContextRegistry code.
Its [receipt](confinement/registry-implementation-traces.json) records 40,000
transitions checked against the TLC-generated eight-state graph or accepted as
stuttering. The receipt hashes the tested source and model inputs. This is a
finite sequential safety comparison; allowing stuttering does not require every
model-permitted operation to succeed in the implementation. Explicit result
assertions require current live authority to succeed and closed, absent or
mismatched authority to fail.

The enumerated operations include both revalidation forms, wrong browser-client
IDs, wrong URLs, stale context IDs and stale installation generations. After
each operation the test checks direct and empty-caller bearer capabilities,
including rejection of a different client. Supplemental seeded-record checks
exercise all four persisted phase labels and each authority-stamp field, and
reject a closed expected identity, and require revalidation to perform no storage
writes. These seeds are not additional
TLC transitions. The test does not establish bearer secrecy or browser identity.
A wrong-owner mutation is checked separately and must fail.

`CloseOwner` is an atomic abstract completion, not the point where the caller
enqueues a close request. This sequential comparison does not establish queue
ordering or cross-instance linearizability; deterministic implementation tests
exercise selected such schedules separately.

The test's `Replace` constructs another ContextRegistry over the same in-memory
store. It represents loss of the registry object's mutation queue, not the
installation-generation replacement modeled by Lifecycle. The test does not
execute CacheStorage persistence, concurrent requests, actual browser client
authentication, guard preparation, publication or worker termination. Those
mechanisms remain outside its correspondence claim.

The main remaining correspondence work is to define observable events for actual
guard completion, publication, authenticated operation, response delivery and
revocation; collect browser/controller traces with generation and owner fields;
and check them against the model's allowed transitions. The current single
network flag is a safety abstraction, not a two-run noninterference property or
a complete account of browser communication.

The FedCM finding illustrates this gap. `LifecycleUnmediatedEffect.cfg` produces
a `NoRemoteTraffic` counterexample when the model permits a bypassing effect.
The [browser receiver test](fedcm-conditional-probe.ts) found a concrete
service-worker-bypassing request in the earlier implementation. The test then
checks a source fix; it does not show that all other browser effects are modeled.

## Deterministic operations across two registries

Run the separate implementation characterization tests with:

```sh
node --test formal/confinement/registry-concurrency-test.ts
```

The tests use actual ContextRegistry and controller-store code with shared
in-memory CacheStorage responses. Promise gates select reads and writes;
bounded waits distinguish a missing checkpoint from a failed assertion. Each
schedule releases and settles pending operations and restores CacheStorage on
failure.

The queued-close test in
[context-model.test.ts](../test/context-model.test.ts) holds closure before its
tombstone is committed, then queues both revalidation forms. Neither can pass
the earlier close; both reject after the gate releases. Across independent
registries, other schedules pause an already-read live snapshot, commit closure
through another registry, then release the old read. A second effective read
rejects the identity/capability without writing any record. Separate schedules
change application, parent, context ID or generation between those reads and
require rejection.

A previous-release controller is modeled by pausing its raw ready-phase storage
write. A newer registry closes the context before that write finishes. The old
write can leave the raw record ready; effective reads remain closed through the
unchanged tombstones. The new implementation itself no longer performs that
phase write. This checks existing controller overlap without adding a migration
branch or deleting stored application data.

The independently runnable handler test uses real browser IndexedDB for
installations and document intents:

```sh
node test/document-consumption-race.ts
```

It invokes the actual document controller with simulated trusted Client/FetchEvent
and context-store inputs. A bounded gate pauses after persistent intent
consumption. The unchanged control returns its exact text; closure, changed
parent or changed context generation before final validation produces an error
response without a body. Chromium and Firefox pass. This tests the
consume-to-revalidation ordering, not native browser client authentication.

Another schedule makes both registries validate the same absent browser client
with different context identifiers before either writes. Both binds fulfill; the
later context wins the client record and both context indexes point to that
client. The superseded context's capability is refused because the indexed
identity no longer matches. Per-instance queues still do not provide
cross-instance binding uniqueness. The test does not establish that the browser
or trusted dispatcher produces those two bindings.

A concurrency model needs two operation program counters, their read snapshots,
raw records/indexes and monotonic closure markers. Its authorization projection
should use effective storage reads. Treating every late raw write as revival
would reject the first schedule even though the tombstone prevents authority
from returning. A binding-uniqueness invariant additionally needs either an
atomic reservation mechanism or an explicit, separately justified browser
reservation assumption.

Normal service-worker replacement is also distinct from installation replacement.
The host activates with `skipWaiting` and `clients.claim`
([worker.ts:136](../src/runtime/worker.ts#L136)); its context store remains in the
same cache, and compatible policy-version bindings survive
([controller-store.ts:77](../src/runtime/contexts/controller-store.ts#L77),
[model.ts:85](../src/runtime/contexts/model.ts#L85)). It resets a controller's
in-memory queues rather than atomically changing every installation generation.
Lifecycle's atomic `Replace` should describe effective revocation of old-epoch
resource authority, not physical termination of all old JavaScript. Pending
requests that validated before replacement need an explicit linearization rule;
the current model does not establish one for every browser callback.

## Duplicate binding: dispatcher reachability and consequences

There are four production calls to `contexts.bind`. All take the client key from
`FetchEvent.resultingClientId`, not an application payload:

- Root navigation: [worker.ts:480](../src/runtime/worker.ts#L480).
- Dedicated-worker bootstrap: [worker.ts:419](../src/runtime/worker.ts#L419).
- Child document or popup:
  [document-controller.ts:177](../src/runtime/contexts/document-controller.ts#L177).
- Shared-worker bootstrap:
  [shared-controller.ts:92](../src/runtime/contexts/shared-controller.ts#L92).

Each awaits binding before returning a trusted shell or bootstrap. Child
documents additionally consume an issued intent through an IndexedDB
transaction before binding
([document-intents.ts:329](../src/runtime/contexts/document-intents.ts#L329)). The
dedicated-worker factory creates a fresh bootstrap UUID per constructor call
([worker-factory.ts:180](../src/runtime/contexts/worker-factory.ts#L180)). Ordinary
resource, readiness and content requests do not create bindings.

The [Service Worker Handle Fetch algorithm](https://w3c.github.io/ServiceWorker/#handle-fetch)
selects an active worker for dispatch and derives the resulting client ID from
the request's reserved client. These are browser-supplied values. This supports
the intended dispatcher design, but the source audit has not established that
two bind-capable events can never share a resulting client across controller
replacement, retries or browser-specific behavior. The two-registry test
therefore demonstrates a storage-level race, not a demonstrated application
path to it.

Binding success does not itself deliver publisher code or grant management.
Subsequent root content validates its current application/generation binding
([worker.ts:512](../src/runtime/worker.ts#L512)); child content also checks the
intent's child client and context ID
([document-controller.ts:252](../src/runtime/contexts/document-controller.ts#L252)).
Worker capability lookup compares the indexed context with the current identity
([model.ts:117](../src/runtime/contexts/model.ts#L117)), so the superseded index
in the deterministic race cannot grant its old capability. Management separately
requires its issued browser-client role
([worker.ts:184](../src/runtime/worker.ts#L184)). A reachable overwrite could still
misattribute or disrupt a client; these checks are not a general proof that all
consequences are harmless. No network disclosure was demonstrated by that test.

The remaining browser correspondence test should record bootstrap destination,
resulting client ID, context ID, controller build and bind outcome while an
actual controller upgrade overlaps root, document and worker startup. Grouping
successful bindings by resulting client would test the assumed uniqueness under
those observed schedules. Instrumentation must use real FetchEvents rather than
supply client IDs through a test RPC.
