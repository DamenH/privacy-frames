# Trusted runtime isolation plan

## Intended result

Application JavaScript runs in the normal browser context. Keep native scripts,
modules, DOM objects, layout, events, asynchronous code and Wasm. Move our trusted
code and state away from application-controlled intrinsics wherever practical.
Code that must remain beside the application is hardened where confinement depends
on it. Application-modifiable implementation details cannot grant authority.

This corrects the earlier plan, which incorrectly put application code inside
ShadowRealm and attempted to recreate its browser interfaces. The application-realm
experiments are research evidence, not release gates for this architecture.

The isolation mechanism follows the responsibility. The trusted host and service
worker already own management, admission, resource responses and context
registration. Use workers for asynchronous work. For synchronous pure computation,
a private iframe or native ShadowRealm can supply independent intrinsics. Native
ShadowRealm and Near Membrane are options, not required application backends.
Avoid adding a membrane when a private primitive-only interface suffices.

## Baseline and retained constraints

Recovery tag `pre-realm-runtime-2026-10-29` points to remote main
`1a78033b48a64b72cd21b4467b96e7c7eba6a2f1`. Production implementation source is
`97f2b835609eedc95c9f52a470c7c32046f1b5fb`. Keep that deployment available until
the replacement passes qualification. Work on branch `realm-runtime` in the
isolated worktree; preserve unrelated work in the original checkout.

- Application requests receive admitted local resources or fail. No network fallback.
- Installation does not execute publisher code. Retain 100 MiB/1,000 resources,
  optional URL lists, integrity checks and runtime admission.
- Do not modify third-party application source or branch on publisher identities.
- Preserve actual native windows, dedicated/shared workers, worklets and prepared
  publisher service-worker executors. Establish restrictions before publication.
- Preserve existing stored data, storage identity and controller authentication.
- Keep manager, runtime and installer on their separate GitHub Pages origins.
  No backend, extension or custom browser build.
- Measure total reachable production code, including dependencies, and separately
  measure code sharing application intrinsics. Moving code alone is not deletion.
- Remove superseded production paths. Preserve experiments outside production.

## Responsibility map

| Responsibility                                                                 | Placement                                         | Boundary                                                                   |
| ------------------------------------------------------------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------- |
| Management and installation consent                                            | Trusted host                                      | Authenticate actual windows/origins and validate messages.                 |
| Admission, admitted resources, context generations and lifecycle authorization | Existing trusted service worker                   | Browser client identity; no application-selected authority.                |
| Document parsing, inert-content compilation and pure source rewriting          | Isolated trusted computation                      | Primitive requests/results; no publisher execution or DOM references.      |
| DOM mutation, synchronous native calls and event cancellation                  | Application context                               | Captured native operations, protected hooks, exact argument normalization. |
| Browser-generated loads and default actions                                    | Browser CSP plus host controller                  | Test network observations independently of page-reported errors.           |
| Native worker/worklet effects                                                  | Context-local enforcement plus trusted controller | Keep actual parallel execution and termination; audit the local remainder. |

The private computation context receives text and configuration, not application
objects or capabilities. It returns serialized data. Its callable and global
references stay in bootstrap closures; errors must not expose foreign objects.
A same-origin iframe is useful only if the application cannot acquire its window.
Create and detach it before publisher execution, and verify reference containment.

## Stage 0 Correct the boundary and establish measurements

Use the existing dependency-aware baseline in `realm-baseline.md`. Inventory each
runtime module by responsibility, inputs, outputs and execution environment.
Record which local guards remain necessary and which hardening can be deleted
only after its consumers move. Keep the original recovery tag intact.

## Stage 1 Isolate synchronous trusted computation

Build one primitive-only computation interface, initially covering document
compilation and context-markup parsing. Bootstrap all trusted code before
publisher execution. Compare native ShadowRealm and a private detached iframe
where usable; ordinary browsers must have a qualified implementation. Do not
move application execution or require a replacement application module compiler.

Test against native/application controls: separate browser scripts retain their
ordinary lexical behavior, synchronous handlers still cancel native actions,
and application Wasm still uses its native engine. Mutating application
intrinsics must not alter isolated parser results. Foreign errors, records,
functions or frame globals must not become application-facing references.

Exercise initialization under real confined CSP in root and child windows,
including SVG and popups. An isolated prototype on an unrestricted page is not
sufficient. Failure to prepare required isolation refuses startup.

## Stage 2 Move policy and simplify local enforcement

Route pure URL/resource calculations and source rewriting through the isolated
interface where synchronous behavior requires it. Keep asynchronous authority in
the existing trusted controller rather than duplicating it in another worker.
Separate DOM acquisition/application from pure decisions. Validate returned
operations and keep local private bookkeeping resistant to application mutation.

Delete obsolete parsing paths and hardening only when no remaining security
consumer needs them. Keep functions that enforce browser effects local when
moving them would change native semantics. Preserve captured-operation ordering,
reentrant coercion checks, private descriptors and listener authentication.

## Stage 3 Contexts and compatibility

Apply the same split to root windows, child documents and popups. Workers and
worklets retain the smallest audited local guards their native APIs require.
Test creation, preparation, publication, replacement, cancellation and revocation.
Late messages cannot revive an earlier generation or acquire management roles.

Retain all eight real applications and their tasks/offline checks: Pitch Training,
PhotoCraft, Wikipedia, diagrams.net, StackEdit, CyberChef, Squoosh and Excalidraw. The hostile playground remains part of security testing. Use the checked-in corpus and captured resource lists; do not quietly
replace a failed application or task. Test ordinary Chromium and Firefox, and
Chromium's native isolation option when that option is qualified.

## Stage 4 Qualification and deployment

Run type checking, formatting, unit tests and the full relevant enforcement,
context, storage, lifecycle, network and compatibility suites. For security
checks, use unrestricted controls and independent network observations.

Compare the final reachable project/dependency source and emitted bundles with
the same baseline scope and resource graphs. Record exposed trusted-code reduction
separately from total reduction. Do not claim either from file moves or dependency
relocation. Revisit initialization and representative DOM/buffer workloads.

Update the report with the implemented architecture, limits and exact evidence.
Run CI, merge the qualified change, publish manager/runtime/installer through their
existing GitHub Pages workflows, then verify deployed assets, installation,
network confinement, stored-data continuity and all real application tasks/offline
checks. Preserve deployment pins and rollback instructions. Do not deploy merely
because an isolated component passes.
