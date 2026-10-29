# Trusted runtime isolation progress

## Direction and recovery

Application code stays in the native browser context. Our trusted computation and
state move into private contexts where practical. Native effect hooks remain
beside the application and keep their current hardening until their consumers
have been audited. This follows the corrected [plan](realm-runtime-plan.md).

Remote main is pinned by `pre-realm-runtime-2026-10-29` at
`1a78033b48a64b72cd21b4467b96e7c7eba6a2f1`. Work is on `realm-runtime` in an
isolated worktree. The public release has not been replaced. Branch CI tests the candidate without
publishing it. Deployment pins are
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
intrinsics. Its construction uses the HTML namespace even in SVG documents. A native
ShadowRealm research control passes the same computation fixture. Production ships
only the iframe implementation. The existing runtime CSP permits trusted setup evaluation.
The renderer fixture now includes that same permission; production CSP was not
relaxed for this change.

The document compiler now uses ordinary arrays, maps and records inside trusted
execution. The old application-realm DOM/Wasm facades and adapters are retained
under `test/realm-research`, outside production source. Near Membrane is a research
dev dependency. Those experiments neither qualify nor block this corrected design.

## Verification so far

- Type checking and formatting pass. The full `npm test` command passes after the
  hardening refactor, including the original 136 unit tests and core, context, storage,
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
  child executable/wrapper output each fall by about 518 KB after parser consolidation. Consolidating runtime
  JavaScript analysis onto Acorn reduces maintained runtime source/dependency bytes
  by 58,411 and emitted runtime bundles by 345,900 bytes. Source lines increase by
  236 because the previous lexer used generated compact source. The installer
  retains its existing lexer.

See `results/trusted-runtime/` and [the size audit](trusted-runtime-size.md).
Existing component receipts are tied to their captured source/artifact hashes;
the final release audit is still outstanding.

After that full-suite run, the final cleanup removed the unused production-native
backend and shared equivalent cache/denial hook setup. Type checking, formatting,
143 unit tests, both computation/boundary fixtures, cache aliases and prototype
confinement pass on that cleanup. Final branch CI remains pending.

## Remaining work

Finish final CI and repeat affected lifecycle/network checks after parser
consolidation. The eight-app task/offline matrix passes on the current local
artifacts: 14 pairs in the first run and two Pitch Training pairs after refreshing
its stale upstream URL inventory. The first branch CI failed on that same removed
Pitch asset; its preceding code/security checks passed. The refreshed catalog is
published at `b8637f0dc5b5e56ae0b6397fdae8501598b7d39e`. The combined audit verifies identical source
and artifact hashes across those runs. No application code was patched.

Record the final byte-based reduction alongside the increased source line count.
Code moved to a private context remains charged to production totals. Complete CI,
report revision and the deployment/public verification stages before claiming the
goal achieved. Branch CI cannot deploy; deployment remains restricted to main.
