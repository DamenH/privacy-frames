# Compatibility evaluation

On the final release, PhotoCraft, Pitch Training and the selected Wikipedia
article complete their confined tasks and offline checks in Chromium and Firefox.
All eight applications complete their selected tasks outside confinement. The
remaining five encounter preparation, script-loading or execution-context
restrictions inside the host.

The [final matrix](../results/evaluation/compatibility-release.json) records all
16 application/browser pairs on host revision
`84d87c224324a67402997cd39d70e0281132912a` and publisher revision
`b8ce7bca6681bc1dd42ee24a783f1555692c03b0`. The
[deployment check](../results/evaluation/compatibility-release-deployment.json)
verifies eight public manager/runtime files against that build before testing.
Both browsers produce these outcomes:

| Application | Selected task | Confined result | First barrier |
| --- | --- | --- | --- |
| PhotoCraft | Import a PNG; paint a stroke | Task and offline startup pass | None for this task |
| Pitch Training | Submit an identification answer; retain history | Task, offline reload and history pass | None for this task |
| Wikipedia | Read article; scroll to final section | Task and offline task pass | None for this task |
| Squoosh | Open an image; change compression quality | Preparation refused | Cleanup worker has no explicit install handler |
| Excalidraw | Draw and move a rectangle | Preparation refused | No explicit install handler observed; `importScripts` also unavailable |
| diagrams.net | Drag a rectangle into a diagram | Installs; startup task fails | Dynamic classic-script creation refused |
| StackEdit | Write Markdown; render preview | Preparation refused | Missing `ExtendableEvent` constructor/prototype |
| CyberChef | Convert synthetic input to Base64 | Installation refused | Embedded `object` creates another execution context |

## Method and publishers

The corpus was fixed before testing: PhotoCraft, Pitch Training, Wikipedia HTML,
Squoosh, Excalidraw, diagrams.net, StackEdit and CyberChef. Each stage uses a fresh
browser context, synthetic input and normal browser storage partitioning. A
working standalone task precedes the confined attempt. Refusals and startup
failures remain in the matrix.

Many web apps use service workers to build offline caches. The host can run their
installation code in a restricted preparation compartment to collect files,
then execute the application against an admitted local resource graph. This
preparation profile provides a limited API; it does not run a native publisher
service worker.

PhotoCraft, Pitch Training, Wikipedia and CyberChef retain their original public
URLs. The four applications whose original installations were blocked by CORS
use explicit copies at
[privacy-frames.github.io/apps](https://privacy-frames.github.io/apps/), separately
from both trusted host origins. Their publisher build relocates known resource
URLs into subdirectories and records before/after hashes in `MODIFICATIONS.json`.
Squoosh's `/editor` client route is declared for relocation. These adaptations
belong to the publisher site; the host has no application-specific branches.

## What the tasks measure

PhotoCraft receives a generated 256 × 256 red PNG through a file-drop event. The
test samples a rendered document pixel before and after painting: opaque red
changes to opaque black. It saves a screenshot before reloading offline. The
reload check establishes editor startup; persistence of an unsaved image was not
measured.

Pitch Training submits an answer and compares its stored history before and
after reload, then repeats the comparison after an offline reload. Wikipedia
renders the selected article and scrolls to its final section while offline.
These tasks do not evaluate microphone exercises, image export or navigation to
uncaptured articles.

Excalidraw's control checks that moving the drawn rectangle changes its saved
x coordinate. Squoosh opens a synthetic image and changes compression quality.
StackEdit produces the expected preview heading from Markdown. CyberChef produces
the expected Base64 output from synthetic text. diagrams.net's control drags a
rectangle from its palette into the SVG diagram.

## Current blockers

Squoosh's conventional `sw.js` is an upstream cleanup stub containing only
`skipWaiting()`. It has no explicit install handler, which the preparation
contract requires. The host therefore stops at preparation before measuring the
compression task inside confinement.

Excalidraw's Workbox bootstrap now defines `self.define` successfully. Its
preparation fails with `Worker has no explicit install handler`; both browsers
also log that `importScripts` is unavailable. The dependency bootstrap does not
complete within the supported preparation model.

diagrams.net's bootstrap creates classic script elements to load additional
code. The final receipt records `Dynamic policy/resource elements are not
admitted` during startup. Supporting this pattern requires both discovering its
resources during installation and mediating their later execution. The optional
`sw.js` request returns 404, separately from the startup failure.

StackEdit's offline-plugin worker patches `ExtendableEvent.prototype.waitUntil`
and `FetchEvent.prototype.respondWith`. Those event constructors are absent from
the preparation compartment. Compatibility would require a preparation-event
facade rather than access to native worker authority.

CyberChef's HTML contains `object#bombe`, which embeds an animated SVG with script
and an `onload` handler. Refusing it follows the current prohibition on additional
execution contexts. Its inert JSON-LD data block is accepted in the final release.

## Earlier comparisons

The [original-URL baseline](../results/evaluation/compatibility-final-baseline.json)
retains all eight original targets in Chromium 153.0.8010.12 and Firefox 155.0.
Squoosh, Excalidraw and StackEdit were blocked by entry-page CORS; diagrams.net was
blocked while fetching its conventional worker. CyberChef was initially refused
for JSON-LD. These outcomes remain separate from the rehosted application results.

The [first Pages matrix](../results/evaluation/compatibility-pages.json), on host
`e09be7e`, exposed Squoosh's missing unqualified `skipWaiting` alias and
Excalidraw's 100-resource limit. The
[capacity/alias comparison](../results/evaluation/compatibility-final.json), on
`97d498b`, raised the resource limit to 1,000 while retaining the 100 MiB byte
limit. Excalidraw then reached the hardened `self.define` assignment. The final
release corrects that namespace while keeping publisher code inside its
compartment. All three Pages comparison matrices retain the same six successful confined
task/offline pairs.

## Evidence and reproduction

Receipts retain source revisions, runner digests, browser versions, entry HTML
digests, stage outcomes and browser errors. Screenshots are namespaced by receipt
filename. The [publisher deployment audit](../results/evaluation/publisher-pages.json)
checks 25 actual GitHub Pages files against the build, including the two GPL
source archives. Publisher inventories and licensing details are in
[publisher-packaging.md](publisher-packaging.md).

Run `node test/evaluation-compatibility.ts` from the host repository. `HOST_URL`
selects the host; `EVALUATION_TARGET` and `EVALUATION_BROWSER` select a subset.
`EVALUATION_URL_OVERRIDES` is an explicit JSON mapping from target IDs to mirror
URLs; original URLs remain recorded in each row. `EVALUATION_STANDALONE_ONLY=1`
runs publisher controls without installation. `PUBLISHER_REVISION` records the
publisher pin and `EVALUATION_RESULTS` selects the receipt path. The runner saves
failures, continues through the corpus and exits unsuccessfully if a standalone
control fails. It does not intercept responses or bypass browser CORS checks.
