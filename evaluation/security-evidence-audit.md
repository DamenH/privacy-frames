# Security evidence audit

This is a source and documentation consistency review. It introduces no new
attack probes, runs no browser tests and makes no runtime changes. Existing tests
and receipts support the observations below; this audit does not replace their
revision and browser provenance. HEAD at review was
`b4dbf2e6367929cf216d883eaf90a5167e587253`, with concurrent evaluation edits in the
worktree. A follow-up inspected `97d498b6708b48a79f52fd66839b84b8a0849489`
and the added lifecycle and compatibility regressions. The final source review
inspected `84d87c224324a67402997cd39d70e0281132912a`, including its diff from
`97d498b` and the current regression assertions and receipts. This audit runs no
tests itself; source-to-run provenance remains the release audit's responsibility.

## Controls and measured coverage

| Area | Source control | Existing evidence | Limit of that evidence |
| --- | --- | --- | --- |
| Management authentication | `src/bridge/connect.ts` accepts only the actual parent at an allowed origin. The manager transfers a port to its own frame with an exact target origin. `src/runtime/worker.ts` resolves the real browser client and requires both its trusted bridge URL and a stored client role. | `test/separate-runtime.ts` rejects an unrelated publisher parent using a real bridge. `test/run.ts` uses a test-only native service-worker handle captured before setup and checks denial of all four management operations from an application client. | These are meaningful checks of separate layers. They do not exhaust window lifecycle, concurrent handshakes or all client transitions. |
| Startup | `guard.ts` checks top-level/no opener, installs restrictions and only then requests prepared application content. Its failure path does not admit application scripts. | `test/run.ts` removes Navigation API support and checks refusal before the app input or `privacyHost` exists. An uncontrolled fresh context receives a static 404. | One deliberately missing prerequisite is measured. This is not failure injection at every setup operation. |
| Routing and identity | `runtime-url.ts` resolves a runtime-origin alias; worker lookup resolves it to exactly one full identity. Worker navigation serves only the canonical entry or a narrow canonicalizing redirect. Other requests match the installation's admitted resources or fail. | Import tests check source-derived aliases, different-origin rejection and label independence. Separate-runtime tests cover a non-index entry, wrong-label redirect, fragment retention and forced alias collision. Core tests check another source with the same label gets separate storage. | No exhaustive URL-normalization or method/query corpus is present. Wrong-label redirects are deliberate behavior, not evidence that labels select authority. |
| Navigation and contexts | Navigation API cancellation, protected effect methods, parser/insertion restrictions, CSP sandbox and resource directives act together. Responses deny framing; guard denies opener-bearing startup. | Core and adversary fixtures cover direct/event paths, named-window targeting and missing Navigation API support. Embedding tests use an unrestricted messaging control and a confined private canary. Website installation tests check unavailable publisher worker mutation and messaging. | Passing selected operations supports the named browser surface. It does not prove every browser-generated navigation or future context API is covered. |
| Installation lifecycle | Preparation uses a disposable host-created worker; management operations are queued; replacement/removal inspect current application clients. Metadata and body publication share an IndexedDB transaction. | Website-installation tests check successful and rejected preparation leave no worker, and refused preparation publishes no card. Core tests reject application replacement while an app window is open. `test/lifecycle.ts` replaces the actual host worker while an app is open, reloads the app, reads the saved note, checks a blocked request against the receiver and reconnects management. The recorded lifecycle receipt passes in both browsers. | Worker replacement is now measured. The lifecycle test reloads the app before checking its behavior; it does not independently exercise continued execution before reload. Forced worker-process termination, BFCache restoration and concurrent navigation during application replacement remain unmeasured. |
| Web Storage | Native captures, scoped proxy views, protected prototype methods and capture-phase storage-event filtering. Event getters return scoped fields and handles. | `test/scoped-storage.ts` checks same-app events, foreign suppression, clear, named properties, property definitions and session separation. Core tests inspect event-carried references and prototype getters. | Same-origin applications rely on this mediation. Paths alone provide no storage separation. |
| IndexedDB and Cache Storage | Factory methods add full-identity prefixes; enumeration strips and filters them. IndexedDB requests and transactions stay native. Host metadata and bodies occupy separate stores. | Scoped-storage tests check prototype calls, independent same-name databases, persisted records, cache matching/deletion and foreign host cache refusal. Cache download tests also check the receiver. | These are tests of particular factory and handle routes, not a general proof over all browser storage APIs. Alternative storage APIs are refused in source. |
| Network observation | Runtime-origin CSP and exact-resource worker policy combine with protected alternate transports. | `test/network.ts` requires real HTTP arrivals, native STUN datagrams and traced DNS sends in unrestricted controls before accepting absent private markers. | The receipt covers synthetic markers and enumerated application routes. It is stronger than an exception-only test but remains route-specific. |

## Findings and dispositions

1. **Corrected report claim:** startup does not detect every storage-partition
   mismatch. `initializeStorage()` checks accessible storage and worker control;
   it does not compare iframe storage with a top-level context. The report now
   explains the measured same-site deployment and this limitation. Existing
   cross-site controls demonstrate accessible but separate storage in both
   browsers.
2. **Evidence qualification retained:** the inventory names controls and tests,
   rather than establishing an unrestricted control for every listed capability.
   The native management probe is deliberately injected before confinement to
   isolate worker authorization. Its purpose should remain explicit.
3. **Repository-link concern withdrawn:** the repository was transferred to
   `privacy-frames/host`. The parent verified that transfer through GitHub's API.
   The report's current inventory link therefore identifies the maintained source.
   The initial finding relied on the former repository name.
4. **Deployment provenance requirement:** current configuration uses
   `apps.pf.damenh.com`; the historical release receipt identifies
   `pf-apps.damenh.com`. Preserve that old provenance and use fresh deployment
   receipts to establish behavior at the new hostname.

## Native captures and callback ordering

The follow-up reviewed the wrapper source without constructing new bypasses or
executing probes. These statuses distinguish code inspection from measured
behavior.

| Mechanism | Static assessment | Measurement status |
| --- | --- | --- |
| Capture timing | `guard.ts` captures native HTML, element creation, insertion and attribute methods before application markup. Policy tools capture reflection and event registration; setup installs wrappers before the trusted content promise admits application scripts. Those captures remain in module/closure scope. | Existing startup-refusal and native-recovery regressions cover selected routes; capture privacy is assessed from source. |
| Protected properties | `method()` refuses protection when an existing property cannot be changed; installed replacements are non-writable and non-configurable. `accessor()` refuses non-configurable originals and makes replacements non-configurable. Missing properties are skipped, so this protects the enumerated surface rather than discovering future APIs. | Missing Navigation API startup refusal is measured. Failures at every individual property patch remain unmeasured. |
| History URL conversion | `navigation.ts` now converts a supplied URL to a string once, validates the parsed destination and passes that same string to the native history method. This removes the former second conversion. | `evaluation-review.ts` and its receipt check one conversion in confined and unrestricted browsers. No disclosure was demonstrated for the earlier behavior. Title coercion and structured-state callback ordering are not independently measured there. |
| HTML parsing and element creation | HTML setters convert to text before validation and pass that text to the native setter. Element constructors convert and validate names before passing their checked strings onward. Captured node getters inspect insertions synchronously. | Existing parser, insertion and unrestricted controls cover named routes. Arbitrary reentrant callbacks during conversion are not exhaustively tested. |
| Attribute names | The follow-up fix stores the converted attribute name in the argument array before validation and native invocation. The original double-conversion question is resolved for this wrapper. | The extended regression and receipt show one `setAttribute` name conversion and the expected value, matching the unrestricted control in both browsers. No disclosure was demonstrated for the former behavior. Namespaced and toggle operations have the same source normalization but are not individually measured by this regression. |
| Resource requests | Alias translation captures URL, Request, fetch and request-URL access before application code. Translated strings are passed to native effects; CSP and worker ownership checks remain separate controls. Request initialization objects and iterable cache inputs can still invoke application callbacks. | Publisher aliases and cache downloads have functional and receiver tests. The reviewed tests do not cover every callback ordering across Request initialization or iterable inputs. |
| Storage wrappers | Full-identity prefixes are closed-over strings. Captured native factory calls receive prefixed names; scoped event getters use captured native getters and namespace checks. Native requests, transactions and cache handles retain browser behavior. | Existing cross-app, prototype, event-handle and persisted-record tests cover specific routes. Arbitrary coercion and options-object callback ordering remain unmeasured. |
| Preparation aliases | New global `clients`, `skipWaiting` and `addEventListener` bindings are references to the already hardened restricted `world` members. `claim` and `skipWaiting` are no-op compatibility functions; event registration writes the private handler map. No native clients collection or worker lifecycle authority is added by these bindings. | The review fixture reaches the prepared activated state through global aliases. Late `waitUntil` refusal and unfinished-download checks remain explicit in source; complete scheduling semantics are not independently measured by that fixture. |
| Initial JSON scripts | Only initial inline `application/json` and `application/ld+json` blocks receive the data exception. External data scripts and speculation rules remain refused. Runtime preparation retains the data nodes; existing mutation and insertion guards still apply to script elements. | Import tests assert data retention and refusal cases. Browser regressions read the JSON, reject type mutation and clone insertion, with a native mutation control. They do not claim execution of JSON as a successful native control. |
| Admission limits | Shared limits now permit 1,000 resources with the unchanged 100 MiB byte cap. Import and admission read the same limits. Admission independently counts resources and hashes bytes before publication. Raising a count limit adds capacity without granting an effect capability. | Static consistency assessed. The follow-up did not run a boundary-size installation or measure resource-exhaustion behavior; availability remains outside the stated threat model. |

## Implemented compartment-global alias

The final preparation source removes `self: world` and defines `self` as an
alias of `compartment.globalThis` before evaluating publisher code. Static review
finds no native worker authority introduced by this change. The installed SES
implementation creates a new `globalObject` for a compartment; the
`Compartment.prototype.globalThis` getter returns that private object. It does
not return the surrounding native worker global.

The existing endowments still determine authority. Registration and location are
hardened data, clients and lifecycle methods are restricted stubs, caches remain
in-memory, and `fetch` remains the download broker. The trusted worker's native
`postMessage`, message listener, pending-download map and final result sender stay
outside the compartment. Assigning application properties such as `self.define`
changes the compartment's namespace, rather than the native worker global.
Writable and configurable `self` lets publisher code replace its own alias; it
adds no reference to a more privileged object.

The implemented definition precedes publisher evaluation and retains those
endowments. The review fixture in `test/server.ts` assigns a publisher namespace
property, checks `self === globalThis`, and throws if `postMessage`, `navigator`,
`Worker` or `importScripts` exists in the compartment global. Successful
preparation in `test/evaluation-review.ts` requires that fixture to complete.
Its retained receipt reaches the activated state in Chromium 153.0.8010.12 and
Firefox 155.0. The website-installation receipt also records successful and
rejected preparation, worker termination and unavailable runtime publisher-worker
operations in both browsers. These checks support the alias and listed absence
claims; they do not establish general Workbox or `importScripts` support.

## Files read

Documentation: `AGENTS.md`, `SURFACE_INVENTORY.md`, `REPORT.md`,
`IMPLEMENTATION.md`, `deployment/config.json`, `results/release.json` and
`results/storage-policy.json`.

Runtime: `worker.ts`, `admission.ts`, `guard.ts`, `response-policy.ts`,
`precache-registration.ts`, `storage.ts`, `enforcement/navigation.ts`,
`enforcement/effects.ts`, `enforcement/dom.ts`, `enforcement/web-storage.ts`,
`storage/indexed-db.ts` and `storage/caches.ts` under `src/runtime/`.

Other source: `src/bridge/connect.ts`,
`src/manager/services/runtime-bridge.ts`, `src/shared/runtime-url.ts` and
`src/shared/policy.ts`.

Tests: `run.ts`, `separate-runtime.ts`, `scoped-storage.ts`,
`website-installation.ts`, `policy.test.ts`, `import.test.ts`, `build.test.ts`,
`storage-policy.ts` and `browser-profile.ts` under `test/`; targeted portions of
`test/embedding.ts`, `test/deployed.ts`, `test/network.ts` and
`examples/adversary/app.ts`.

Follow-up source: `src/runtime/enforcement/native.ts`,
`src/runtime/resource-aliases.ts`, `src/installation/prepare-worker.ts`,
`src/installation/import-website.ts`, `src/installation/document.ts` and
`src/runtime/document.ts`; changes from `b4dbf2e` through `97d498b` to the previously
listed policy and navigation files. Follow-up evidence:
`test/evaluation-review.ts`, `test/lifecycle.ts`,
`results/evaluation/review-regressions.json` and
`results/evaluation/lifecycle.json`.

The alias review also inspected the installed SES implementation in
`node_modules/ses/src/compartment.js`: compartment global-object creation and the
`globalThis` getter. The attribute-normalization follow-up re-read
`src/runtime/enforcement/dom.ts`, `test/evaluation-review.ts` and its current
receipt.

Final-source follow-up: diff `97d498b..84d87c2` for preparation, attribute
normalization, the review fixture and regression, and `REPORT.md`; current
`evaluation/security-review.md`, `results/evaluation/review-regressions.json` and
`results/website-installation.json`. The report retains its accessible-partition
qualification and shared browser-permission limitation. Fresh public checks for
this source were pending when this audit was finalized; no old public receipt is
presented here as evidence for the final deployment.

## Verification after the source audit

The primary agent subsequently verified final source `84d87c2` through successful
manager/runtime Pages deployments, 51 matching public assets, both-browser
installation/storage/embedding checks and the complete final corpus. Fresh CI
receipts and their hashes are indexed in `results/ci.json`; the final deployment
and requirement audit is `evaluation/COMPLETION.md`. This closes the deployment
evidence requirement without changing the scope of the independent source audit.
