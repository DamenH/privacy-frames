# Partial startup-trace comparison with Lifecycle

Run after the local browser matrix has written its receipt:

```sh
node formal/startup/local-run.ts
node formal/startup/lifecycle-trace-test.ts
```

The comparison regenerates the unchanged `LifecycleSafe.cfg` graph using the
pinned TLA+ jar and Java container. It currently contains 114 states and 260
labeled transitions. The checker walks actual TLC edges; it does not implement
an independent TypeScript version of the model's transition rules.

All four recorded Chromium/Firefox schedules have allowed completions. Both
actual early-release controls pass the security model: their preparation and
publication are valid, although they deliberately violate the experiment's
upgrade-before-release ordering. Thirty calibration cases reject missing or
misordered preparation/publication, an invalid modeled parent, forged observed
parent/reserved-client fields, and inappropriate installation replacement.

## Projection

| Concrete observation                                                      | Model action                            | Qualification                                                                                                            |
| ------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Successful root bind matching an actual native reserved-client FetchEvent | CreateRoot                              | Browser identity and URL correlation are checked.                                                                        |
| Root executing the fixture before it creates a child                      | Prepare(root), Publish(root), Run(root) | These three transitions are an explicit **unobserved prefix assumption**. This checker does not verify root preparation. |
| Successful child bind with the actual root browser client as parent       | CreateChild(child,root)                 | Application/generation must match; exactly one root and one child are supported.                                         |
| Trusted local guard pause timestamp                                       | Prepare(child)                          | The test hook is after the reviewed preparation, compilation and shell-load sequence.                                    |
| Native controllerchange, confirmed by a controller-B manager RPC          | Stutter                                 | Controller replacement is **not** Lifecycle.Replace, which changes the installation epoch and revokes contexts.          |
| Release of the test pause                                                 | Stutter                                 | Original source/origin/token checks and publication still follow.                                                        |
| First application probe sees its published Window                         | Publish(child), then Run(child)         | Publish is **inferred** between release and this probe, not separately instrumented.                                     |

The controller-update stutter interpretation also relies on the reviewed source:
normal controller activation does not reinstall the application or mint a new
installation generation. The receipt's root/child generation labels are
normalized to epoch zero; it contains no installation-replacement schedule.

There is no general epsilon completion search. The only inserted actions are
the declared root prefix and the single child Publish. Child Prepare cannot be
silently supplied when it is absent or arrives after Run. Every non-stuttering
step must match one uniquely labeled outgoing TLC edge.

The exact child publication time is unknown. The inferred transition does not
exclude an earlier transient exposure through a different browser reference
path. The fixture's selected prepared-feature probes likewise do not establish
every guard postcondition.

## Calibration and evidence

The checker tests each observed schedule with child Prepare removed, child
Prepare moved after Run, Publish moved before Prepare, inferred Publish removed,
and a wrong modeled parent. It also mutates the observed parent and native
reserved-client correlation and requires projection validation to refuse them.
For upgrade-before-release schedules, replacing the native-update stutter with
Lifecycle.Replace must fail: the later publication cannot use the revoked old
epoch. That calibration is not imposed on an early-release trace ending after a
Replace, because the partial observations would not necessarily distinguish it.

`lifecycle-graph.json` records the TLC graph and model/config/tool hashes.
`lifecycle-comparison.json` records the browser receipt, checker/generator hashes,
normalizations, inserted assumptions, accepted paths and rejected calibrations.
The receipt's runner, local-gate and observer hashes must match current files.

This is a small partial-observation correspondence check, not whole-runtime
refinement or verification of all five invariants. It projects no forged-authority
acceptance, installation replacement, cancellation, revocation, arbitrary worker
startup or complete browser-effect stream. Safe-model fault switches remain
assumptions about the implementation. Production code and the model are unchanged.

Standalone strict type checking:

```sh
npx tsc --ignoreConfig --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --types node formal/startup/lifecycle-trace-test.ts
```
