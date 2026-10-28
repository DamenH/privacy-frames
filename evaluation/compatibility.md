# Compatibility evaluation

The corpus contains PhotoCraft, Pitch Training, Wikipedia HTML, Squoosh,
Excalidraw, diagrams.net, StackEdit and CyberChef. Each comparison runs a useful
standalone task before attempting that task inside confinement. Installation,
startup, task completion and offline execution are recorded separately.

## Current local evidence

The current implementation adds partial resource capture, prepared child contexts,
prototype compatibility and ordinary client-side routes. The table summarizes available local receipts. A complete comparison of this
revision and its public deployment checks are still pending.

| Application    | Task                                                    | Evidence and verification still required                                                                          |
| -------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| PhotoCraft     | Import a PNG and paint a stroke                         | Task and offline startup passed in the 27 October comparison; current revision needs a fresh run                  |
| Pitch Training | Submit an answer and retain history                     | Chromium passed in that comparison; Firefox encountered a reload wait timeout; current revision needs a fresh run |
| Wikipedia      | Read the article and scroll to a section                | Task and offline task passed in that comparison; current revision needs a fresh run                               |
| Excalidraw     | Draw and move a rectangle                               | Task and offline reload passed in that comparison, with some fonts blocked; current revision needs a fresh run    |
| Squoosh        | Encode a PNG to JPEG, change quality and inspect output | Targeted Chromium and Firefox tests pass, including offline re-encoding                                           |
| diagrams.net   | Create and edit a diagram                               | Startup and offline configuration are under investigation; final task receipts pending                            |
| StackEdit      | Write Markdown and inspect its preview                  | Prototype compatibility work is in progress; final task receipts pending                                          |
| CyberChef      | Process text and a file                                 | Targeted text, file and offline testing is in progress; final browser-pair verification pending                   |

The [27 October comparison](../results/evaluation/compatibility-contexts-review.json)
and its [provenance](../results/evaluation/compatibility-contexts-review-provenance.json)
predate the installation-origin and prototype changes. Squoosh's stronger local
receipts are [Chromium](../results/evaluation/squoosh-encoded-offline.json) and
[Firefox](../results/evaluation/squoosh-firefox-offline-ready.json). The Squoosh receipts come from separate runs.

## Tasks and publishers

PhotoCraft receives a generated red PNG. The test paints a stroke and samples the
rendered image: opaque red changes to opaque black. Its offline check establishes
editor startup, without claiming persistence of an unsaved image. Pitch Training
compares saved exercise history across ordinary and offline reloads. Wikipedia
renders and scrolls the selected article; navigation to uncaptured articles is
outside that task.

Excalidraw's test verifies that moving a rectangle changes its saved x coordinate.
Squoosh receives a deterministic 256 × 256 noise PNG, produces a smaller JPEG,
and verifies the decoded dimensions and file signature. Changing quality must
produce different JPEG bytes. The task exercises a real browser worker and repeats
encoding after an offline reload.

StackEdit's task checks the rendered heading produced from Markdown. CyberChef's
tasks check expected text output and file hashes. diagrams.net's task creates and
edits a diagram. Where a publisher provides an offline startup option, the test
may select that documented URL option. The runtime has no publisher-specific
branch for it.

CyberChef's cancellation/SVG task passes in [standalone Chromium](../results/evaluation/cyberchef-native-cancel-bounded-final.json).
In [native Firefox](../results/evaluation/cyberchef-native-cancel-firefox-final.json),
automation does not reliably observe the animated SVG before the operation
finishes; other runs crash after worker cancellation. The current Firefox result
does not verify this task.

PhotoCraft, Pitch Training, Wikipedia and CyberChef use their original public
URLs. CORS-readable licensed copies of the other applications are hosted at
[privacy-frames.github.io/apps](https://privacy-frames.github.io/apps/), separately
from trusted host origins. Their existing packaging relocates resource URLs for
subdirectory hosting and records changes in `MODIFICATIONS.json`. This batch adds
compatibility in the host rather than patching application behavior. Inventories
and licenses are described in [publisher-packaging.md](publisher-packaging.md).

## Historical release

The [previous deployed matrix](../results/evaluation/compatibility-release.json)
used host revision `84d87c224324a67402997cd39d70e0281132912a` and publisher revision
`b8ce7bca6681bc1dd42ee24a783f1555692c03b0`.
Its [deployment check](../results/evaluation/compatibility-release-deployment.json)
verified public files before testing. That release passed selected confined tasks
for PhotoCraft, Pitch Training and Wikipedia; the other applications encountered
preparation, script-loading or context restrictions.

The [original-URL baseline](../results/evaluation/compatibility-final-baseline.json),
[first Pages comparison](../results/evaluation/compatibility-pages.json) and
[capacity comparison](../results/evaluation/compatibility-final.json) retain the
same targets and earlier failures.

## Reproduction

Run `node test/evaluation-compatibility.ts`. `HOST_URL` selects the host;
`EVALUATION_TARGET` and `EVALUATION_BROWSER` select a subset.
`EVALUATION_URL_OVERRIDES` maps target IDs to explicit publisher copies.
`EVALUATION_STANDALONE_ONLY=1` runs publisher controls without installation.
`EVALUATION_RESULTS` selects the receipt path. The runner retains errors and
screenshots, continues through failed confined tasks and exits unsuccessfully if
a standalone control fails. `EVALUATION_REQUIRE_CONFINED=1` also requires every
selected confined task and offline reload to pass. Receipts include local source
and artifact hashes before and after execution; changing built artifacts during
a run fails verification. Public deployment checks must independently establish
which artifacts the remote host serves.

Tests use synthetic input and fresh browser contexts. Release evidence must record
the tested artifacts and browser versions, repeat the complete corpus, and verify
the public deployment separately. Compatibility tasks establish selected behavior;
hostile fixtures and independent receivers test confinement.
