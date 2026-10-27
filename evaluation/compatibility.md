# Compatibility evaluation

The fixed corpus contains PhotoCraft, Pitch Training, a Wikipedia REST HTML
article, Squoosh, Excalidraw, diagrams.net, StackEdit and CyberChef. Tests first
perform a local task outside confinement, then install and attempt the same task
in the host. Each stage uses a fresh browser context, synthetic input and normal
browser storage partitioning. Every target remains in the results, including
refused installations and failed startup attempts.

The [original-URL baseline](../results/evaluation/compatibility-final-baseline.json)
records all eight targets in Chromium 153.0.8010.12 and Firefox 155.0. PhotoCraft,
Pitch Training and Wikipedia completed their confined tasks and offline checks.
Four applications could not be downloaded under their publishers' CORS policies.
CyberChef was refused for an inert JSON-LD script element.

## GitHub Pages copies

The four CORS-blocked applications were republished at
[privacy-frames.github.io/apps](https://privacy-frames.github.io/apps/), separately
from both trusted host origins. Each copy retains upstream notices and a per-file
source URL/SHA256 inventory. The publisher build relocates known resource URLs
into app subdirectories and records changed files in `MODIFICATIONS.json`.
Squoosh's `/editor` client route is also declared for relocation. These are
publisher adaptations; the host has no application-specific branches.

The [Pages matrix](../results/evaluation/compatibility-pages.json) uses host
revision `e09be7ef31529ec2eadad5f3c7f42212110370ef` and publisher revision
`b8ce7bca6681bc1dd42ee24a783f1555692c03b0`. PhotoCraft, Pitch Training, Wikipedia
and CyberChef retain their original URLs. Squoosh, Excalidraw, diagrams.net and
StackEdit use their explicit Pages copies. All sixteen standalone task controls
pass. Both browsers produce the same confinement outcomes:

| Application | Selected task | Confined outcome | First observed blocker |
| --- | --- | --- | --- |
| PhotoCraft | Import a PNG; paint a stroke | Task and offline startup pass | None for this task |
| Pitch Training | Submit an identification answer; retain history | Task, offline reload and history pass | None for this task |
| Wikipedia | Read article; scroll to final section | Task and offline task pass | None for this task |
| Squoosh | Open an image; change compression quality | Preparation refused | Unqualified `skipWaiting` missing from preparation globals |
| Excalidraw | Draw and move a rectangle | Installation refused | 100-resource admission limit |
| diagrams.net | Drag a rectangle into a diagram | Installs; startup task fails | Dynamic classic-script creation refused |
| StackEdit | Write Markdown; render preview | Preparation refused | Missing `ExtendableEvent` constructor/prototype |
| CyberChef | Convert synthetic input to Base64 | Installation refused | Embedded `object` creates another execution context |

## After the shared preparation fixes

The [second complete matrix](../results/evaluation/compatibility-final.json) uses
host revision `97d498b6708b48a79f52fd66839b84b8a0849489`. The resource-count limit
is 1,000, the byte limit remains 100 MiB, and existing preparation operations also
have their standard unqualified global aliases. All sixteen standalone controls
and the same six confined task/offline pairs pass.

Squoosh now reaches the explicit-install-handler requirement. Excalidraw proceeds
past the 100-resource limit and reaches its Workbox bootstrap, which tries to add
`self.define` to the hardened preparation facade. Both browsers refuse that write.
The diagrams.net, StackEdit and CyberChef blockers remain unchanged. This matrix
records the next barriers after the shared fixes; the earlier receipt retains
the original first failures.

## What the tasks establish

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
x coordinate. Squoosh's control opens a synthetic image and changes compression
quality. StackEdit produces the expected preview heading from Markdown. CyberChef
produces the expected Base64 output from synthetic text. diagrams.net's control
drags a rectangle from its palette into the SVG diagram.

## Blocker analysis

Squoosh's conventional `sw.js` is an upstream cleanup stub containing only
`skipWaiting()`. Preparation exposes that operation on `self`, but the tested
release omits its unqualified global alias. The stub also has no explicit install
handler, which the current preparation contract requires.

Excalidraw reaches the resource-count limit during installation. The byte limit
remains 100 MiB. A larger resource-count budget can distinguish this capacity
limit from subsequent loader or runtime requirements without allowing network
fallback.

A [Chromium diagnostic](../results/evaluation/drawio-pages-diagnostic.json) records
diagrams.net's startup exception: `Dynamic policy/resource elements are not
admitted`. Its bootstrap creates classic script elements to load additional code.
Supporting this pattern requires both discovering those resources during
installation and mediating their later execution. The optional `sw.js` request
returns 404, which is separate from the observed startup failure.

StackEdit's offline-plugin worker patches `ExtendableEvent.prototype.waitUntil`
and `FetchEvent.prototype.respondWith`. Those browser event constructors are not
available in the preparation compartment. Compatibility would require an accurate
preparation-event facade, not access to native worker authority.

CyberChef now passes the inert JSON-LD stage. Its HTML also contains `object#bombe`,
which embeds an animated SVG with script and an `onload` handler. Refusing that
object follows the current prohibition on additional execution contexts.

## Evidence and reproduction

The [publisher deployment audit](../results/evaluation/publisher-pages.json)
checks 25 actual GitHub Pages files against the built release, including the two
GPL source archives. The receipts retain source revisions, runner digests, browser versions, entry
HTML digests, stage outcomes and browser errors. Screenshots from current runs
are namespaced by receipt filename. Publisher inventories, source archive hashes
and license details are in [publisher-packaging.md](publisher-packaging.md).

Run `node test/evaluation-compatibility.ts` from the host repository. `HOST_URL`
selects the host; `EVALUATION_TARGET` and `EVALUATION_BROWSER` select a subset.
`EVALUATION_URL_OVERRIDES` is an explicit JSON mapping from target IDs to mirror
URLs; original URLs remain recorded in each row. `EVALUATION_STANDALONE_ONLY=1`
runs publisher controls without installation. `PUBLISHER_REVISION` records the
publisher pin and `EVALUATION_RESULTS` selects the receipt path. The runner saves
failures, continues through the corpus and exits unsuccessfully if a standalone
control fails. It does not intercept responses or bypass browser CORS checks.
