# Compatibility evaluation

The corpus contains PhotoCraft, Pitch Training, Wikipedia HTML, Squoosh,
Excalidraw, diagrams.net, StackEdit and CyberChef. Each comparison runs a useful
standalone task before attempting that task inside confinement. Installation,
startup, task completion and offline execution are recorded separately.

## Public release

The [public matrix](../results/evaluation/compatibility-explicit-lists-public.json)
passed all 16 browser/application pairs on 29 October 2026, completing at
10:51:09 UTC. It used Chromium 153.0.8010.12 and Firefox 155.0 against
`https://pf.damenh.com/`, on host source
`97f2b835609eedc95c9f52a470c7c32046f1b5fb`. Artifact hashes remained stable.
The [deployment check](../results/assets.json) independently matched the public
files to that build.

| Application    | Selected task                                          | Chromium task/offline | Firefox task/offline |
| -------------- | ------------------------------------------------------ | --------------------- | -------------------- |
| PhotoCraft     | Import a PNG and paint a stroke                        | Passed/passed         | Passed/passed        |
| Pitch Training | Submit an answer and retain history                    | Passed/passed         | Passed/passed        |
| Wikipedia      | Read the article and scroll to its final section       | Passed/passed         | Passed/passed        |
| Excalidraw     | Draw and move a rectangle; check its saved coordinate  | Passed/passed         | Passed/passed        |
| Squoosh        | Encode a PNG to JPEG and change quality                | Passed/passed         | Passed/passed        |
| diagrams.net   | Drag a rectangle from the palette; observe changed SVG | Passed/passed         | Passed/passed        |
| StackEdit      | Edit Markdown and render the preview heading           | Passed/passed         | Passed/passed        |
| CyberChef      | Produce expected To Base64 output                      | Passed/passed         | Passed/passed        |

All seven applications needing supplemental resources selected their published
URL lists. Wikipedia used automatic discovery alone. Installation took
1.07–4.09 seconds in Chromium and 1.06–4.03 seconds in Firefox. The
[local matrix](../results/evaluation/compatibility-explicit-lists-local.json)
also passed all 16 pairs on the earlier replacement build; the public matrix
above verifies the final source including the CSS parser correction.

## Tasks and resources

PhotoCraft receives a generated red PNG; painting changes a sampled pixel to
opaque black. Its offline check establishes editor startup, without claiming
persistence of an unsaved image. Pitch Training compares saved exercise history
across ordinary and offline reloads. Wikipedia renders and scrolls the selected
article; navigation to uncaptured articles is outside that task.

Excalidraw verifies that moving a rectangle changes its saved x coordinate.
Squoosh encodes a deterministic 256 × 256 noise PNG into a smaller, decodable JPEG;
changing quality must produce different output bytes. Encoding repeats offline.
StackEdit checks the rendered Markdown heading before and after offline reload.
diagrams.net repeats palette insertion offline. Its documented offline URL option
is selected by the catalog, with no publisher-specific runtime branch.

[Deeper CyberChef checks](../results/evaluation/cyberchef-text-file-explicit-lists-public.json)
pass native and confined text round trips and file hashes in both browsers, with
confined offline repetition. [Chromium cancellation/SVG checks](../results/evaluation/cyberchef-cancel-explicit-lists-public.json)
pass native controls and confined online/offline cancellation, restart and
animated SVG rendering. Firefox cancellation remains unverified: its native
control does not reliably expose the animation and can crash after cancellation.

PhotoCraft, Pitch Training, Wikipedia and CyberChef use their original public
URLs. CORS-readable licensed copies of the other applications use
[privacy-frames.github.io/apps](https://privacy-frames.github.io/apps/). Their
packaging and modification inventories are described in
[publisher-packaging.md](publisher-packaging.md). This change adds separate URL
lists; it does not modify application files or execute them during installation.

## Reproduction

Run `node test/evaluation-compatibility.ts`. `HOST_URL` selects the host;
`EVALUATION_TARGET` and `EVALUATION_BROWSER` select a subset.
`EVALUATION_URL_OVERRIDES` maps target IDs to explicit publisher copies.
`EVALUATION_STANDALONE_ONLY=1` runs publisher controls without installation.
`EVALUATION_RESULTS` selects the receipt path. Set
`EVALUATION_REQUIRE_CONFINED=1` to require every selected confined task and offline
check to pass. Receipts retain browser versions, errors, selected lists,
installation times and before/after artifact hashes.

The [completion audit](COMPLETION.md) links final CI, independent network controls
and public checks. Historical matrices remain in version control and apply only
to their recorded revisions.
