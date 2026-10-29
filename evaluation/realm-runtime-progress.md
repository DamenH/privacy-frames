# Trusted runtime isolation progress

## Direction and recovery

Application code stays in the native browser context. Our trusted computation and
state move into private contexts where practical. Native effect hooks remain
beside the application and keep their current hardening until their consumers
have been audited. This follows the corrected [plan](realm-runtime-plan.md).

Remote main is pinned by `pre-realm-runtime-2026-10-29` at
`1a78033b48a64b72cd21b4467b96e7c7eba6a2f1`. Work is on `realm-runtime` in an
isolated worktree. The public release has not been replaced. Deployment pins are
in [realm-recovery.json](realm-recovery.json).

## Implemented candidate

The root window, child HTML/SVG documents and popups now create private trusted
computation before publisher execution. The computation receives serialized text
and configuration and returns serialized results. Its callable and frame remain
in bootstrap closures. Foreign error objects do not cross that interface.

Document compilation, context-markup parsing and dynamic markup validation execute
in that private context. Local hooks acquire actual native DOM arguments and
apply the result. Application scripts, modules, promises, layout, events and Wasm
continue using the browser directly. Management, admission, resource responses and
context authorization remain in the existing trusted host/service worker.

The ordinary-browser implementation uses a detached private iframe with independent
intrinsics. Its construction uses the HTML namespace even in SVG documents. A
native ShadowRealm adapter passes the same computation fixture; it is not yet the
production default. The existing runtime CSP permits trusted setup evaluation.
The renderer fixture now includes that same permission; production CSP was not
relaxed for this change.

The document compiler now uses ordinary arrays, maps and records inside trusted
execution. The old application-realm DOM/Wasm facades and adapters are retained
under `test/realm-research`, outside production source. Near Membrane is a research
dev dependency. Those experiments neither qualify nor block this corrected design.

## Verification so far

- Type checking and formatting pass. The full `npm test` command passes after the
  hardening refactor, including all 136 unit tests and core, context, storage,
  installation, worker/worklet, publisher and prototype-confinement checks.
- The shared computation fixture passes in native Chromium ShadowRealm, Chromium
  iframe and Firefox iframe. Application script bindings, event cancellation and
  native Wasm remain intact while application prototype mutation leaves the
  private parser unchanged.
- The independent integrated boundary fixture passes in Chromium and Firefox.
  Its unrestricted control recovers a deliberately exposed foreign frame. The
  guarded cases inspect coercion callbacks, indexed prototype hooks, errors,
  stack data and own Window properties without finding a private frame or foreign
  callable/object. These are scoped boundary checks, not a network proof.
- HTML/XML parser-hook mutation, document-factory and committed HTML/native SVG
  renderer controls pass in both browsers. The renderer fixture now permits the
  trusted setup evaluation already allowed by production CSP.
- The code-size audit includes the embedded trusted bundle and all its dependencies.
  Both window guards have zero parse5/entities executable contributions. Root and
  child executable/wrapper output each fall by about 315 KB. Combined maintained
  production source is 86 lines larger and deployment bundles are 11,283 bytes
  larger. Total code reduction has not been achieved.

See `results/trusted-runtime/` and [the size audit](trusted-runtime-size.md).
Existing component receipts are tied to their captured source/artifact hashes;
the final release audit is still outstanding.

## Remaining work

Address the remaining total-code increase without weakening confinement or adding
application-specific behavior. Code moved to a private context is still production
code. Run the remaining lifecycle/network checks and the eight-application
task/offline corpus against the final build. Complete CI,
report revision and the deployment/public verification stages before claiming the
goal achieved. Branch CI cannot deploy; deployment remains restricted to main.
