# Evaluation and migration

## Deliverables

1. Transfer `DamenH/privacy-frames` to `privacy-frames/host` and the deployment
   repository to `privacy-frames/runtime`. Create `privacy-frames/apps` for
   maintained publisher source, licensed snapshots and external catalog links.
2. Keep manager `pf.damenh.com`; move runtime to `apps.pf.damenh.com`; publish
   unrestricted apps at `privacy-frames.github.io/apps/`. All use GitHub Pages.
   Verify separate origins, actual Pages assets/TLS, the installation bridge,
   storage and offline execution. Document the origin-local data transition.
3. Preserve the original eight-target, two-browser baseline. Rehost CORS-blocked
   publishers when a static distribution and reasonable license permit it.
   Preserve notices, corresponding sources where needed, source hashes and any
   packaging modifications. Verify standalone tasks from the final Pages paths
   before evaluating confined behavior. Keep externally hosted examples external.
4. Review native references, reentrancy, parsing/insertion, contexts, storage,
   routing/admission and management/lifecycle. Record coverage and limitations;
   confirm findings with regressions and working controls. Network conclusions
   require independent calibrated observations.
5. Classify compatibility failures before changing the host. Implement general
   fixes that preserve confinement, keeping original and post-change evidence.
   Application-worker support remains separate design work.
6. Update the short report and release evidence. Record exact source pins,
   browsers, deployment runs and verification scope. Audit each deliverable
   against the deployed state before calling the work complete.

## Boundaries

No backend, request proxy, extension, publisher-specific host adapters or IFC
implementation is added. Self-installation is recorded as a future idea only.
A failed target remains in the corpus. An accessible storage API is not evidence
that an embedded and top-level document use the same storage partition.

## Evidence

- Original compatibility: `results/evaluation/compatibility-final-baseline.json`.
- Original deployment assets: `results/evaluation/compatibility-deployment.json`.
- Baseline enforcement: `results/evaluation/baseline/`.
- Publisher license/source inventory: `evaluation/publisher-packaging.md` and
  `results/evaluation/publishers/`.
- Primary source review: `evaluation/security-review.md`.
- Independent evidence audit: `evaluation/security-evidence-audit.md`.
- New regressions: `test/evaluation-review.ts` and `test/lifecycle.ts`.

Final public publisher, post-change corpus, cutover and release receipts are
required in addition to this baseline evidence.
