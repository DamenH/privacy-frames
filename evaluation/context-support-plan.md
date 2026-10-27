# Context support implementation

Baseline: host `596c0be1e4de35e992a762babc89d489bdfb21f9`, deployed source
`84d87c224324a67402997cd39d70e0281132912a`.

The runtime owns creation and preparation of application contexts. Application code
and usable references must remain confined throughout startup, operation and
replacement. Children inherit their application's resource and storage identity;
none receives management authority. Failure closes the requested context.

## Ordered stages

1. Extract shared identity, resource, storage and effect controls; introduce typed
   context states and authenticated parent/child ownership. Preserve startup order.
2. Admit dynamic classic/module and generated scripts in the existing confined
   realm, with installed-resource loading and native ordering/events.
3. Make publisher precaching optional and transactional. Discard failed preparation
   contributions; independently captured resources still undergo full admission.
4. Add trusted dedicated-worker bootstraps: classic, module, Blob and nested
   workers, preserving native messaging/transfer behavior and applying policies
   before publisher execution.
5. Add child HTML/SVG document adapters and iframe/srcdoc/data/Blob support.
   Demonstrate that initial documents and every exposed reference are safe before
   relying on later script initialization.
6. Complete CyberChef text recipes, worker/file processing, cancellation/restart,
   animation and offline tests through the general mechanisms.
7. Extend context adapters to popups/named windows, shared workers and worklets.
   Mediate publisher service-worker behavior while retaining host authority over
   executable responses and network access.

## Gates

Every stage needs an independent functional fixture, hostile cases with working
controls, both Chromium and Firefox, exact source/browser provenance and regression
checks for earlier stages. Network conclusions require calibrated independent
DNS/HTTP/TCP/UDP observations. New contexts require recursive-child checks,
application-scoped storage and independent denial of management authority.

Keep the fixed eight-app corpus and failed targets. Record each newly reached
blocker. No publisher-specific enforcement branches, backend, request proxy,
extension, private-data installation state or runtime network fallback is added.
Shared-origin browser permissions remain the documented future design issue.

Completion requires the whole sequence and deployed evidence. A working app or a
passing subset of tests is not proof that the context boundary is complete.

## Local implementation status

Stages 1–4 have implementations and browser fixtures. Dedicated classic, module,
Blob and nested workers pass Chromium and Firefox, including offline workers
discovered from actual script loading expressions without preload declarations.
The common window preparation is extracted for the document adapter. Optional
publisher precaching commits its contributions only after full validation.

Worker routes bind actual browser context identifiers where available. Nested
requests without a browser client identifier use a context-scoped bearer for
immutable resource reads and readiness only. Host-issued installation generations
revoke prior resource access after replacement; metadata and resource bodies are
checked in the same storage transaction. Firefox module descendants require a
separate request classification, verified against native worker creation.

The child-document adapter remains disabled. A retained blank document alone is
insufficient: Firefox exposed a fresh realm before trusted load capture in 3 of
40 re-navigation trials. Setting the trusted HTTP source before insertion, then
synchronously preparing the initial realm, preserved protections across the first
commit in 40 Firefox and 8 Chromium trials. That commit established native
service-worker control and activated the preinstalled navigation listener.

Batch insertion of a frame followed by an inline script still exposes the initial
realm before the insertion wrapper returns. The adapter must prepare pending
frames before that script executes. These platform experiments do not enable
child documents or establish the complete document boundary.

Fresh context receipts are under `results/contexts/`. Source and built-artifact
hashes distinguish local worktree evidence from the published release. No part of
this context-support work has been deployed yet. Stages 5–7, the final corpus
evaluation, report revision and deployment remain required.
