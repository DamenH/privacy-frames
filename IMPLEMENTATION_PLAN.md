# Implementation and acceptance gates

The agreed scope is a static host that confines installed applications, supports
transparent scoped storage and demonstrates an independently developed JavaScript
application. No extension, application backend, request proxy or browser changes
are required. IFC, selective release and general update/migration work remain out
of scope or deferred.

## Completed implementation

- [x] Audit fresh execution contexts and alternate native authority. Protect
  creation, parsing, insertion, navigation, getters, events and prototype routes.
  Evidence: `SURFACE_INVENTORY.md`, policy tests and hostile browser probes.
- [x] Separate manager and runtime origins; authenticate the actual manager
  opener/origin and browser client role. Use readable, source-bound application
  URLs and launch without an opener. Evidence: separate-runtime and deployed tests.
- [x] Scope localStorage, sessionStorage, IndexedDB and Cache Storage, including
  named properties, enumeration, clear, storage events and recovered prototypes.
  Preserve same-app windows and session lifetimes. Evidence: scoped-storage tests.
- [x] Accept suitable existing URLs without a Privacy Frames manifest; preserve
  relative/root-relative resources, modules and hash navigation. Map exact
  installed publisher URLs locally without rewriting executable JavaScript.
  Evidence: ordinary website, original-URL alias and Pitch Training tests.
- [x] Run explicit public preparation with fresh state and no private input;
  await install/activate promises, capture resources and terminate preparation
  before launching a fresh isolated document. Never yield native runtime worker
  authority or allow a network fallback. Evidence: preparation authority receipt,
  normal completion, failed preparation and unsupported-worker-operation tests.
- [x] Install the original Pitch Training URL without application source changes.
  Verify Svelte rendering, sampled playback, microphone analysis and shutdown,
  denied permission, actual IndexedDB score records, settings/history, hash routes
  and offline reload. Compare installed executable hashes with publisher bytes.
- [x] Observe DNS, HTTP/TCP and native STUN UDP independently in Chromium and
  Firefox, with working unrestricted controls. Close the measured Firefox DNS
  escape using runtime-only CSP plus local aliases. Keep browser-maintenance
  requests separate. Evidence: `results/network*.json`.
- [x] Retain Notes, Image editor, Reader, Adversary and Playground; add an ordinary
  PWA and repeat the public installation/launch flows. Evidence: browser and
  deployed receipts. Public publishers use separate origins from the manager.
- [x] Publish the static manager/runtime and publishers, standalone report,
  feature matrix, operation inventory and reproducible test commands. The manager
  has its own origin because unrelated GitHub project paths are not isolated.
  GitHub Pages and the earlier shared link are entry points to that origin.

## Final release checks

- [ ] Commit and publish implementation and example sources; required CI passes.
- [ ] Verify delivered asset hashes and both entry points against release files.
- [ ] Reconcile live browser/audio receipts, report and service inventory.
- [ ] Complete the requirement-by-requirement audit with no required work left.

Browser versions, calibration counts, retained policy observations and actual
measurements live in `results/`. These gates concern the documented supported
browser/application profile, not a universal or machine-checked confinement proof.
