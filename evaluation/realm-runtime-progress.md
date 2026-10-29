# Realm runtime implementation progress

## Recovery

Remote main is pinned by the annotated tag `pre-realm-runtime-2026-10-29` at
`1a78033b48a64b72cd21b4467b96e7c7eba6a2f1`. The source and deployment pins are
recorded in [realm-recovery.json](realm-recovery.json). Work is isolated on branch
`realm-runtime`. The public sites and original working directory are unchanged.

## Current milestone

Milestone 0 has reproducible dependency-aware code and bundle measurements in
[realm-baseline.md](realm-baseline.md). The baseline runtime graph contains
31,306 project/dependency lines. Near Membrane adds 5,248 dependency lines before
shared bridge code; net simplification remains to be demonstrated.

Milestone 1 has working bridge experiments but its prerequisite gate fails. The
production entry points do not import the new experimental adapters or capability
bridge. Full migration and deployment have not started.

- Primitive/callable boundaries and independent intrinsics pass in native
  Chromium, ordinary Chromium/Near Membrane and Firefox/Near Membrane.
- One shared DOM bridge passes real layout, identity, reentrant callbacks and
  synchronous checkbox default-action cancellation in all three modes. Revocation
  blocks subsequent host operations; application Array changes leave host arrays
  unchanged. Native Document prototypes remain unchanged.
- Direct native module loading crashes the installed Chromium renderer, including
  full Chromium, ordinary parser-created scripts, two tested flag combinations
  and successful unrestricted module controls.
- One guest-local SystemJS linker demonstrates live bindings, cycles, top-level
  await and dynamic imports through primitive hooks on both adapters. A production
  compiler and its code cost remain unresolved. TypeScript is used only to
  prepare research fixtures, not as a shipped solution.
- Native Function construction works from guest Promise callbacks, but fails in
  synchronous wrapped entry. Native guest Wasm compilation fails in both entry
  contexts, including deferred instantiate, with and without explicit permissive
  CSP. Guest structuredClone transfer crashes all four entry/policy combinations.
  Host controls succeed. The same Wasm fixture compiles and reads the expected
  memory value in both Chromium and Firefox Near Membrane environments.
- A primitive buffer path works without raw-object crossing: exact canvas pixels
  and a real 1 MiB worker round trip preserve detachment and bytes. One measured
  native-base64 run copied 4 MiB in about 3 ms and 16 MiB in about 8.9 ms.
- Near Membrane leaves native browser globals in its detached realm. An empty
  global shape does not establish the required capability profile. Authority
  qualification remains open.
- Classic script controls were compared across four bounded strategies and three
  profiles (228 rows). None preserves all 19 cases. Top-level declaration
  lowering, continuation scopes and lexical-cell prototypes retain different gaps
  in reflection, closures, strict declarations, eval or Function construction.

## Reproduction

`node test/realm-adapters.ts` and `node test/realm-dom.ts` exercise the current
shared adapter/DOM contract. Loading, buffer and classic-script probes have
separate runners and receipts under `results/realms/`; fallback authority has an
inventory, not a qualified enforcement profile. Their diagnostic
success does not establish that Milestone 1 passed or that a replacement runtime
is ready for deployment.

## Next actions

The priority question is whether full native parity remains mandatory or a
portable-first architecture may retain native mode as experimental. That answer
changes the scope of the next implementation stage. Preserve the pending decision
and complete independent checkpoint work; do not replace failed required gates
with the prototype's narrower positive checks.

`npm run test:realm-probes` reproduces the observations.
`npm run test:realms` additionally runs the prerequisite qualification and exits
unsuccessfully on the current classic/compiler/Wasm gaps. A fresh full execution
from checkpoint `6dc326d` completed all diagnostic runners and reached those
three failing prerequisite checks. A passing diagnostic
reproduction is not a migration pass.
