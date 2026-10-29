# Realm runtime implementation plan

## Intended result

Replace the runtime that shares a window with application code with one runtime
whose browser operations pass through an explicit capability bridge. Application
JavaScript has its own intrinsics. Trusted code owns the real rendering document
and browser capabilities.

Use native ShadowRealm when available and a Near Membrane implementation when it
is unavailable. Both implement the same internal contract and capability policy.
Test Chromium with the flag enabled and disabled, and Firefox using the fallback.
Do not implement two renderers, two application loaders or two policy systems.

The objective is less production code and less trusted code exposed to application
mutation. Count maintained dependencies and vendored code as well as project code;
moving complexity into a library does not by itself meet that objective. The final
release must retain the eight-application task/offline corpus and network policy.

## Baseline and constraints

The implementation baseline is host source
`97f2b835609eedc95c9f52a470c7c32046f1b5fb`, with evidence and documentation at
`1a78033b48a64b72cd21b4467b96e7c7eba6a2f1`. The
[completion audit](COMPLETION.md) identifies deployment pins, CI and public checks.
The installer is 1,129 TypeScript lines; runtime source is approximately 14,000
lines. Recompute all comparison measurements from those commits.

Retain these requirements throughout implementation:

- After confinement begins, application requests receive admitted local resources
  or fail. No network fallback, installer proxy or application-selected policy.
- Installation follows declarations and optional URL lists without executing
  publisher code. Keep the 100 MiB/1,000-resource limits and runtime admission.
- Third-party application source stays unchanged. General resource relocation is
  allowed; publisher-specific patches and branches are not.
- Preserve native rendering, synchronous layout reads and event cancellation,
  normal asynchronous application code, and the currently supported context types.
- Keep application storage identity and existing private data. Cross-application
  storage and browser-permission isolation remain outside the prototype guarantee.
- Keep the three trusted sites on GitHub Pages, separate from publisher content.
  No backend, extension, custom browser build or new hosting dependency.
- The native backend may require the experimental browser flag. The fallback must
  work in ordinary supported browsers. There is no unconfined production backend.
- Preserve unrelated local changes, session logs and proposal drafts. In
  particular, do not include the existing local-file-export discussion changes in
  this work without separately establishing their ownership and scope.

The deployed release remains available during development. Once the replacement
passes its gates, delete the superseded implementation rather than shipping it as
a third runtime. Preserve the previous release through version control and pins.

## Shared architecture

```text
application window environment
        |
guest browser interfaces and value conversion
        |
synchronous capability bridge
        |
trusted rendering document and browser operations
        |
host service worker: admitted-resource and management gates
```

The realm adapters provide creation, bridge connection, script evaluation and
disposal. They do not decide whether an application may navigate, fetch, create a
context or access management. Their exact TypeScript interface is an outcome of
the first implementation milestone, rather than an attempted implementation of
the entire proposed global ShadowRealm API.

Design the bridge for [native ShadowRealm's primitive/callable boundary](https://tc39.es/proposal-shadowrealm/#sec-getwrappedvalue) first.
Represent browser objects with scoped handles and application-side facades;
normalize data and callbacks at the boundary. Near Membrane must implement that
same contract rather than give the fallback a separate direct-DOM path. Preserve
object identity where the supported browser API requires it. Assess byte-buffer
copying and batching early; do not build a per-byte RPC interface for image work.

The wire contract must cover callback receivers, constructors, object identity,
errors and asynchronous completion. Promises and buffer objects cannot be passed
directly through native wrapped calls. Create application-facing promises and
errors in the guest, and deliver completion through the shared protocol. A native
brand-check failure requires an explicit adapter rather than a raw-object escape.

The trusted side invokes actual browser APIs. It does not reimplement layout,
rendering, canvas or a new application UI framework. Supported operations have
explicit receiver, argument, result and callback rules. Unknown members must not
be automatically forwarded into browser authority.

Pin the Near Membrane revision and license. Reuse the existing implementation
where it fits; do not copy the whole archived monorepo into the host. Record local
changes and run relevant upstream tests. Include its reachable production code in
the size and maintenance comparison.

### Context profiles

| Environment                              | Execution and policy placement                                                                                                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root and child windows, including popups | Application runs through the selected realm adapter; the real document remains trusted and application-facing browser objects are mediated.                                                                         |
| Dedicated and shared workers             | Preserve actual native worker execution and termination. Put resource, creation and authorization decisions in the trusted controller/parent where possible; document and audit every remaining worker-local guard. |
| Worklets                                 | Preserve real browser worklet execution. Inventory its available capabilities and keep payload loading and communication restricted to the owning application.                                                      |
| Publisher service-worker behavior        | Retain prepared executors and mediated events; publisher code never gains native controller or installer authority.                                                                                                 |

An iframe cannot be created inside a worker. Do not assume that the window
fallback can be installed there. Milestone 1 must establish the worker/worklet
design and identify its remaining trusted code before approving full migration.
Native worker separation is useful, but it does not itself remove worker network
authority. Ordinary workers/worklets may still need local guards sharing the
application intrinsics; count and audit that remainder instead of attributing
window-realm isolation to those contexts. Moving worker computation onto the main thread or faking worker
termination is not an acceptable compatibility shortcut.

### Security invariants

1. Application code never executes in the trusted rendering or management realm.
2. Browser authority reaches application code only through reviewed interfaces.
   Indirect references, callbacks and errors preserve that boundary.
3. Every supported context has the resource and effect restrictions before
   application execution or access to an unrestricted child.
4. Browser effects caused internally by markup, CSS, navigation or native default
   actions obey the same policy as explicit application API calls.
5. Installation and management authority depend on actual trusted browser clients
   and host-owned state, not application-provided identities or handles.
6. Disposal, cancellation and replacement revoke handles and pending operations;
   a late callback cannot revive a closed generation.

Disposal means revoking bridge authority, scheduled callback delivery and owned
contexts. ShadowRealm has no native termination method; revocation must not be
described as forcibly stopping arbitrary computation. Availability remains outside
the threat model. Native worker termination remains a required application feature.

A visible application record is not an exfiltration finding by itself. Trace a
suspected bypass to changed enforcement, forbidden authority or an independently
observed communication. Keep compatibility failures distinct from security ones.

## Milestone 0 Establish the comparison

Create an isolated branch/worktree and retain the existing release pins. Read the
current source and the earlier
[synchronous membrane prototype](/home/damen/Classes/independent-study/host-confinement-main-thread/README.md).
The [design discussion](/home/damen/Classes/independent-study/topic-proposal-discussion.md)
records the native ShadowRealm direction and earlier findings.

Freeze captured resource graphs for local comparisons and record their source
URLs and hashes. Verify live publisher bytes separately for release; if upstream
content changes, rerun the baseline against the same bytes used by the candidate.

Record production source/dependency sizes, emitted bundle sizes, startup timings
and representative DOM/buffer workloads. Separate window bridge, context
lifecycle, parser, publisher-worker and effect-policy costs. Measure code that
runs beside application code separately from trusted code elsewhere.

Create a capability inventory with four classifications: supported now, feasible
with an adapter, deliberately refused, and unresolved. For each entry identify
the native authority, policy owner, returned objects, callbacks and tests. Cover
DOM/CSS/layout/events, canvas/media, storage, local exports, script loading,
contexts, navigation and alternate transports. Feasible entries need a mechanism,
not an implementation promise.

Exit: reproducible baseline measurements and a dependency-aware code inventory.
Historical reports are input evidence, not verification of the new backend.

## Milestone 1 Prove that the shared adapter stays small

Build an isolated harness using the actual native ShadowRealm behind the Chromium
flag and the pinned Near Membrane fallback. Keep it outside the production launch
path until this gate passes.

Run identical cases through both adapters:

- Create an element, set text, attach it and read real layout synchronously.
- Deliver a genuine browser event; call application `preventDefault()` during the
  original dispatch and verify that the native default action is cancelled.
- Preserve node identity across repeated lookups and return paths, including
  `ownerDocument`, `defaultView`, events and supported constructor/prototype use.
- Modify application Array/Object prototypes and verify that trusted objects use
  independent intrinsics. Exercise reverse callbacks and reentrant operations.
- Run multiple classic scripts and module imports. Compare global/lexical scope,
  module identity and namespace behavior with native controls; do not assume that
  repeated `evaluate` calls reproduce browser script semantics.
- Round-trip cyclic data and an image-sized guest-owned typed array. Exercise
  canvas, worker messages and WebAssembly, checking mutation visibility and actual
  synchronous detachment where native transfer requires it. Probe guest APIs such
  as structuredClone rather than assuming they exist. Record copies, peak memory
  and elapsed time; a host buffer handle alone is not typed-array compatibility.
- Dispose an environment and attempt to reuse saved objects and callbacks.
- Probe actual realm availability and remaining globals in windows, workers and
  worklets. Establish the context-profile design above and its trusted remainder.

Native evaluate calls do not preserve top-level lexical declarations across
calls as ordinary browser script elements do. The first milestone must choose a
shared global-lexical execution strategy, including strict scripts, redeclarations
and dynamic insertion. Concatenating initial scripts does not resolve asynchronous
ordering. Any generic loader source adaptation must have an explicit scope and
native comparisons; if it requires the excluded general instrumentation compiler,
record that as failure of the proposed small-adapter approach.

Exercise actual native importValue and guest dynamic imports against admitted
resources before choosing a loader design. Include object exports retained inside
the guest, cycles, live bindings, top-level await and import.meta. ShadowRealm does
not provide a general userland hook for supplying arbitrary module source.

Demonstrate that the fallback starts with only the reviewed authority and shared
bridge contract. Test detached-window globals, native constructor recovery,
location and parent/opener paths; global-object mapping alone is insufficient.

Tests assert which adapter actually executed. Forced-native tests fail if the
feature is unavailable; they must never silently exercise the fallback. Default
selection uses native only when its required controls are established. Native
unavailability may select the qualified fallback; a shared admission or policy
failure refuses startup. Dispose failed setup and revoke issued handles before
starting a fresh fallback environment. Once application code has executed, a
backend failure stops that environment; it must not silently replay the program
or move its live state into another backend. Test these failure cases.

Exit: one bridge contract with thin backend adapters and passing native controls
for the cases above. Provide an itemized deletion map and code estimate covering
the bridge, both adapters, loader, data conversion and reachable membrane code.
The estimate must show a net reduction against the same baseline scope. Resolve
the script/module and buffer decisions with working prototypes before scaling up.
Do not proceed with two independently implemented browser bridges. If this gate
cannot be met after focused redesign, preserve the harness and report the exact
architectural obstacle instead of expanding into a second runtime or silently
dropping either backend.

## Milestone 2 Implement the shared browser boundary

Create shared realm, bridge and policy modules with explicit inputs. Keep backend
internals isolated so policy and feature modules do not branch on native versus
fallback execution. Use interface descriptions to remove repetitive wrapper code
where useful; an interface description does not establish that an operation is
safe.

Implement object identity, method receivers, property access, constructors,
callbacks, exceptions and supported structured data conversions. Validate the
exact argument consumed by the browser once. Retain the earlier stateful
`toString`, inherited getter/setter and reentrancy attacks as independent fixtures.
Do not pass a raw host object because a proxy fails a native brand check.

Start with native DOM, events, timers, resource aliases, canvas/buffers and storage.
Support framework behavior through ordinary interfaces. Application-level code
generation is limited to justified generic loading/bridging needs; a general
JavaScript instrumentation compiler is outside this plan.

Exit: shared capability tests pass through both adapters; unsupported operations
fail explicitly. Native default actions and resource loads retain independent CSP
and controller enforcement.

## Milestone 3 Integrate all application code loading

Adapt `guard.ts`, the document compiler/renderer, script policy and module loader
to execute publisher JavaScript in the application environment. Initial HTML
becomes trusted rendering operations plus guest execution requests.

Account for classic scripts and their ordering, inline scripts, static/dynamic
modules, Blob code, event-handler attributes, application evaluation/Function
constructors, custom elements and callbacks from browser APIs. Handle module
resolution, cycles, live bindings, top-level await, `import.meta` and asynchronous
failure behavior through a shared loader strategy. Do not add application-specific
syntax or resource inference to the installer.

The trusted rendering document must not execute application scripts or native
inline handlers accidentally. Test parser-created scripts, handlers, SVG and
document replacement attempts. Keep the actual native parser comparison before
live insertion. Replace regex-based CSS URL rewriting with shared syntax-aware
handling on the trusted side, while preserving unrelated strings/comments.

Exit: framework fixtures and the root application tasks run on the new path;
hostile script routes cannot execute in the trusted realm or reach a receiver.

## Milestone 4 Migrate contexts and publisher behavior

Route child HTML/SVG documents and popups through the same window environment and
bridge. A returned handle remains mediated throughout creation and preparation.
Test early indexed/named access, nested creation, closure, cancellation and parent
navigation. Retain actual browser-client, parent and generation authorization in
the controller.

Integrate dedicated/shared workers, Blob/module/nested workers and worklets using
the context profiles established in Milestone 1. Preserve actual parallel worker
execution, message ordering, immediate transfer/detachment and termination. Move
authoritative state out of guest workers where feasible. Test any local policy
code against mutable application intrinsics and forbidden-constructor recovery.

Keep publisher registration, install/activate/fetch/message and executor rebinding
semantics. Do not fake lifecycle completion or restore installation-time
execution. Every publisher network operation still uses the admitted graph.

Exit: the complete context, publisher, storage and lifecycle suites pass, including
CyberChef cancellation/restart against a working native control.

## Milestone 5 Attack and explain the boundary

Maintain one adversarial suite run against native and fallback execution. Cover
raw reference recovery, prototype/constructor paths, callback receivers,
double conversion, parser/default-action effects, early children, navigation,
alternate transports and management/installer relays. Include new browser APIs
in surface inventories without exporting them automatically.

Use independent HTTP/TCP, DNS and STUN observers with active unrestricted
controls. A browser exception alone is not evidence that no request escaped.
Exercise the supported contexts, not just the root window.

Write an argument for each invariant that names the enforcement location and
assumptions. Model the bounded context lifecycle if it helps check ordering and
revocation; do not make a formal model of all JavaScript or full IFC an execution
dependency. Models and tests must remain linked to the actual implementation.

Exit: no unresolved demonstrated escape, working observer controls and an explicit
account of remaining unsupported or unmeasured behavior. Independent review may
run in parallel, but implementation and receiver evidence remain required.

## Milestone 6 Retain compatibility and remove superseded code

Run the eight-application useful-task and offline matrix on Chromium native,
Chromium fallback and Firefox fallback. Keep publisher bytes and URL lists fixed.
Repeat deeper CyberChef text/file and Chromium cancellation/SVG tasks, plus Pitch
Training audio, microphone and persistence checks. Native Firefox cancellation
remains unverified unless its unrestricted control can establish that task.
Require all 24 selected application/browser/backend task and offline pairs across
the three mandatory modes; do not silently substitute a backend or omit a target.

Test both automatic backend selection and failure during setup. Refuse launch
before private input when the selected backend cannot establish the boundary.
Use the same tasks and controls to compare startup, interaction and buffer costs.
Investigate regressions against the baseline; do not regain speed by dropping
checks or weakening isolation.

Delete old window-global mutation machinery, prototype restrictions, parser paths,
duplicate context preparation and private helper code where the new architecture
has replaced their responsibility. Keep captured operations where they still
protect a real trust boundary. Move obsolete fixtures to version history rather
than retaining a legacy execution switch.

Recount production code using the same scope as the baseline: project runtime
plus reachable production dependency code, including vendored or packaged membrane
code. Require a net reduction in that combined total, and identify the reduction
in code executing beside application code. Report the project/dependency split
and emitted bundle costs as well, without counting unused monorepo files or
manufacturing a reduction through minification or file movement. If the
two-backend design cannot satisfy the simplification objective without losing the
security or compatibility requirements, report that result before release.

Local file export is a separately recorded compatibility gap. Encoding bytes is
not proof that clicking Download works; do not claim that migration fixes it
without an actual saved-file test and hostile external-download controls.

Exit: all required comparisons pass, superseded production paths are removed and
the measured code reduction is documented. Temporary development coexistence must
not remain in the final production build.

## Milestone 7 Publish and verify

Finish source, type, formatting and regression checks on one immutable revision.
CI must test native Chromium with `--js-flags=--harmony-shadow-realm`, ordinary Chromium
fallback and ordinary Firefox fallback. Record browser versions and actual
backend selection. Preserve the native controls and the separate network suite.

Publish manager, runtime and installer from the same tested source through the
existing GitHub Pages workflows. Keep publisher resources off trusted origins.
Release the unflagged fallback as the normal portable path; the native path works
when the browser exposes the tested primitive. Require no experimental flag from
ordinary users and do not expose an unconfined option.

Verify public file hashes and repeat installation, useful tasks, offline behavior
and network attempts. Test the public site in both Chromium modes and Firefox.
Do not replace desktop-browser evidence with claims of WebKit or real-device
mobile support. Update REPORT, implementation documentation, capability inventory
and release audit. Distinguish newly produced receipts from historical files.

Exit: published artifacts match the final source, public checks pass, the report
describes the actual boundary, and no required migration work remains.

## Test commands and implementation boundaries

Extend the existing browser-profile helper and test runners rather than creating
another browser harness. Add `npm run test:realms` to run adapter/bridge contract
cases in the three mandatory modes. Preserve the existing core, context, network,
corpus and deployed-test entry points and add the same backend matrix to them.
CI must assert the actual backend and retain its launch configuration with each
receipt. Test forcing belongs to the trusted harness/configuration, not an
application-supplied privilege field.

Keep the implementation grouped by responsibility:

| Source area                                                     | Migration work                                                                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| New runtime realm adapters                                      | Common lifecycle contract and only backend-specific construction/crossing machinery.                            |
| New shared capability modules                                   | Guest facades, value conversion, operation policy and trusted browser invocation.                               |
| guard.ts, document compiler/renderer, scripts.ts and modules.ts | Route every publisher execution path through the application environment.                                       |
| contexts and publisher modules                                  | Retain native context execution, ownership, preparation and revocation while removing replaced local machinery. |
| worker.ts, admission and resource/storage modules               | Preserve controller authority, installed-resource policy and private data identity.                             |
| test/browser-profile.ts, fixtures, runners and CI               | Run the same positive controls and hostile cases under each required mode.                                      |

New module names may change during implementation. The separation of policy from
backend choice must remain visible, and the final build must not retain an old
renderer or loader behind an unused compatibility option.

## Autonomous execution

Proceed through passing milestones without asking for routine confirmation.
Choose implementation details within the shared contract and record consequential
decisions with their tests. A failing gate requires diagnosis, a reproducer and a
fix followed by the affected checks; do not relabel the gate as optional.

Keep an implementation journal with the current commit, completed milestone,
exact live process/job handles, commands/results and remaining work. Resume live
jobs rather than restarting them because observation timed out. Keep browser
servers and shared builds under one owner; unrelated source and private data must
remain intact.

Parallel work can cover capability inventory, independent attack fixtures,
upstream membrane review and corpus preparation. Stabilize the shared adapter
before parallel implementation of adapters and feature modules. Assign separate
files and test ports; integrate in dependency order and keep public deployment
under one owner.

Pause dependent implementation only for a concrete obstacle requiring a changed
security promise, application patches, an additional substantial runtime,
destructive private-data handling or unavailable external authority. First finish
independent work and present the exact unresolved decision with evidence. A
missing optional browser API is normally a supported-profile decision, not a
reason to request permission repeatedly.

The recorder, general updates, per-application origins, IFC implementation and a
new JavaScript engine are outside this migration. The final deliverables are the
single runtime, its two small window realm adapters, context profiles, capability
catalog, adversarial/compatibility evidence, measured simplification, updated
report and verified public deployment.
