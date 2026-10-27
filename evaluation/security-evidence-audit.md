# Security evidence audit

This is a source and documentation consistency review. It introduces no new
attack probes, runs no browser tests and makes no runtime changes. Existing tests
and receipts support the observations below; this audit does not replace their
revision and browser provenance. HEAD at review was
`b4dbf2e6367929cf216d883eaf90a5167e587253`, with concurrent evaluation edits in the
worktree.

## Controls and measured coverage

| Area | Source control | Existing evidence | Limit of that evidence |
| --- | --- | --- | --- |
| Management authentication | `src/bridge/connect.ts` accepts only the actual parent at an allowed origin. The manager transfers a port to its own frame with an exact target origin. `src/runtime/worker.ts` resolves the real browser client and requires both its trusted bridge URL and a stored client role. | `test/separate-runtime.ts` rejects an unrelated publisher parent using a real bridge. `test/run.ts` uses a test-only native service-worker handle captured before setup and checks denial of all four management operations from an application client. | These are meaningful checks of separate layers. They do not exhaust window lifecycle, concurrent handshakes or all client transitions. |
| Startup | `guard.ts` checks top-level/no opener, installs restrictions and only then requests prepared application content. Its failure path does not admit application scripts. | `test/run.ts` removes Navigation API support and checks refusal before the app input or `privacyHost` exists. An uncontrolled fresh context receives a static 404. | One deliberately missing prerequisite is measured. This is not failure injection at every setup operation. |
| Routing and identity | `runtime-url.ts` resolves a runtime-origin alias; worker lookup resolves it to exactly one full identity. Worker navigation serves only the canonical entry or a narrow canonicalizing redirect. Other requests match the installation's admitted resources or fail. | Import tests check source-derived aliases, different-origin rejection and label independence. Separate-runtime tests cover a non-index entry, wrong-label redirect, fragment retention and forced alias collision. Core tests check another source with the same label gets separate storage. | No exhaustive URL-normalization or method/query corpus is present. Wrong-label redirects are deliberate behavior, not evidence that labels select authority. |
| Navigation and contexts | Navigation API cancellation, protected effect methods, parser/insertion restrictions, CSP sandbox and resource directives act together. Responses deny framing; guard denies opener-bearing startup. | Core and adversary fixtures cover direct/event paths, named-window targeting and missing Navigation API support. Embedding tests use an unrestricted messaging control and a confined private canary. Website installation tests check unavailable publisher worker mutation and messaging. | Passing selected operations supports the named browser surface. It does not prove every browser-generated navigation or future context API is covered. |
| Installation lifecycle | Preparation uses a disposable host-created worker; management operations are queued; replacement/removal inspect current application clients. Metadata and body publication share an IndexedDB transaction. | Website-installation tests check successful and rejected preparation leave no worker, and refused preparation publishes no card. Core tests reject replacement while an app window is open. | The reviewed tests do not explicitly cover a runtime-worker process restart, a host-worker replacement while applications remain open, BFCache restoration or concurrent navigation during replacement. |
| Web Storage | Native captures, scoped proxy views, protected prototype methods and capture-phase storage-event filtering. Event getters return scoped fields and handles. | `test/scoped-storage.ts` checks same-app events, foreign suppression, clear, named properties, property definitions and session separation. Core tests inspect event-carried references and prototype getters. | Same-origin applications rely on this mediation. Paths alone provide no storage separation. |
| IndexedDB and Cache Storage | Factory methods add full-identity prefixes; enumeration strips and filters them. IndexedDB requests and transactions stay native. Host metadata and bodies occupy separate stores. | Scoped-storage tests check prototype calls, independent same-name databases, persisted records, cache matching/deletion and foreign host cache refusal. Cache download tests also check the receiver. | These are tests of particular factory and handle routes, not a general proof over all browser storage APIs. Alternative storage APIs are refused in source. |
| Network observation | Runtime-origin CSP and exact-resource worker policy combine with protected alternate transports. | `test/network.ts` requires real HTTP arrivals, native STUN datagrams and traced DNS sends in unrestricted controls before accepting absent private markers. | The receipt covers synthetic markers and enumerated application routes. It is stronger than an exception-only test but remains route-specific. |

## Claims to correct or qualify

1. The report says that installation stops rather than using a partition separate
   from the launched application. `initializeStorage()` checks whether local
   storage and IndexedDB operations succeed, then checks worker control. It does
   not compare iframe storage with a top-level context. The existing cross-site
   receipt demonstrates accessible embedded storage that differs from top-level
   storage in both browsers. Describe same-site deployment and its measured
   sharing result; do not claim general runtime detection of partition mismatch.
2. The inventory names controls and tests but is not evidence that every listed
   capability has an independent unrestricted control. For example, the native
   management probe is deliberately injected before confinement to isolate worker
   authorization. Describe that test's purpose rather than treating it as an
   ordinary application capability.
3. The report's inventory link points to `github.com/privacy-frames/host`, whereas
   the implementation repository is `DamenH/privacy-frames`. The link should identify
   the maintained source.
4. Current deployment configuration uses `apps.pf.damenh.com`; the existing release
   receipt identifies `pf-apps.damenh.com`. That historical receipt cannot establish
   the new hostname's deployment or storage behavior. Keep old provenance and
   obtain new evidence for the changed deployment.

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
