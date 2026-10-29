# Compatibility evaluation

The corpus contains PhotoCraft, Pitch Training, Wikipedia HTML, Squoosh,
Excalidraw, diagrams.net, StackEdit and CyberChef. Each comparison runs a useful
standalone task before attempting that task inside confinement. Installation,
startup, task completion and offline execution are recorded separately.

## Previous release: public evidence

The [complete public matrix](../results/evaluation/compatibility-release-public.json)
passed all 16 browser/application rows: the standalone task, confined task and
application-specific offline check. It ran on 28 October 2026 from 20:38:33 to
20:50:53 UTC, using Chromium 153.0.8010.12 and Firefox 155.0.

| Application    | Task                                                   | Chromium task / offline check | Firefox task / offline check |
| -------------- | ------------------------------------------------------ | ----------------------------- | ---------------------------- |
| PhotoCraft     | Import a PNG and paint a stroke                        | Passed / passed               | Passed / passed              |
| Pitch Training | Submit an answer and retain history                    | Passed / passed               | Passed / passed              |
| Wikipedia      | Read the article and scroll to its final section       | Passed / passed               | Passed / passed              |
| Excalidraw     | Draw and move a rectangle; check its saved coordinate  | Passed / passed               | Passed / passed              |
| Squoosh        | Encode a PNG to JPEG and change quality                | Passed / passed               | Passed / passed              |
| diagrams.net   | Drag a rectangle from the palette; observe changed SVG | Passed / passed               | Passed / passed              |
| StackEdit      | Edit Markdown and render the preview heading           | Passed / passed               | Passed / passed              |
| CyberChef      | Produce expected To Base64 output                      | Passed / passed               | Passed / passed              |

The matrix ran against `https://pf.damenh.com/` on source
`2dfcbc2e8be6d9ec64bc3c20789446b59977e14e`. Its before/after artifact maps match
exactly (`artifactsStable: true`), including runtime `sw.js` SHA-256
`ebf627533c7eaa363ffc5261cabe74f42b99e11e38507b7265d524538fee2f0b`.

## Final-source CI and public artifacts

Source `2dfcbc2e8be6d9ec64bc3c20789446b59977e14e` passed the
[final CI run](https://github.com/privacy-frames/host/actions/runs/40763844471),
including the regression suite, selected functional tests and calibrated network
checks. The [fresh receipt index](../results/evaluation/final-ci-receipts.json)
separates those results from historical files in the CI artifact.

The [public HTTPS check](../results/assets.json) matched 59 files to their build
hashes. These hashes identify the deployed build. The public matrix, deeper
CyberChef tests and [Pitch Training checks](../results/pitch-training-deployed.json)
have passed. The [general host-interface checks](../results/deployed.json) also
passed in both browsers; deployment
revisions are recorded in the [completion audit](COMPLETION.md).

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

StackEdit's task checks the rendered heading produced from Markdown and repeats
the task after offline reload. The corpus CyberChef task checks expected To Base64
output. diagrams.net drags a rectangle from the palette and checks the changed
SVG, then repeats that task offline. Where a publisher provides an offline startup
option, the test may select that documented URL option. The runtime has no publisher-specific
branch for it.

The [public CyberChef text/file tests](../results/evaluation/cyberchef-text-file-release-public.json)
pass in standalone and confined execution on both browsers. They check a
52-byte text round trip and the expected SHA-256 of a 2,900-byte file, repeated
offline in confinement.

Chromium's [public cancellation/SVG tests](../results/evaluation/cyberchef-cancel-release-public.json)
also pass: cancellation/restart terminates two workers and renders animated SVG,
with an offline repeat in confinement and a working standalone control.

In [native Firefox](../results/evaluation/cyberchef-native-cancel-firefox-final.json),
automation does not reliably observe the animated SVG before the operation
finishes; other native runs crash after worker cancellation. Firefox
cancellation/restart and animated SVG remain unverified. Firefox has separate passing text/file and offline checks; the corpus row covers
the smaller To Base64 task.

PhotoCraft, Pitch Training, Wikipedia and CyberChef use their original public
URLs. CORS-readable licensed copies of the other applications are hosted at
[privacy-frames.github.io/apps](https://privacy-frames.github.io/apps/), separately
from trusted host origins. Their existing packaging relocates resource URLs for
subdirectory hosting and records changes in `MODIFICATIONS.json`. This batch adds
compatibility in the host rather than patching application behavior. Inventories
and licenses are described in [publisher-packaging.md](publisher-packaging.md).

## Earlier comparisons

The [earlier local matrix](../results/evaluation/compatibility-release-local.json)
also passed all 16 task/offline rows on a stable intermediate build. Its source
snapshots were `5be286df9aca0e982fb47c2ac153422dcbabe93a` and
`3c9f7839e147ae5af5800edcc080a79614b43193`, before the publisher-scope and URL-getter
changes. The public matrix above supersedes it for release verification.

## Previous release

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
