# Compatibility evaluation

The corpus was fixed before testing: PhotoCraft, Pitch Training, a Wikipedia REST
HTML article, Squoosh, Excalidraw, diagrams.net, StackEdit and CyberChef. Each test
opens the original public URL in a fresh browser context, performs a local task,
then attempts installation into the deployed Privacy Frames host in another fresh
context. No application source, response headers or host policy is changed.

The authoritative receipt is
[`compatibility-final-baseline.json`](../results/evaluation/compatibility-final-baseline.json).
It records the repository revision, test-script digest, browser versions, original
HTML digest, installation result, task result and browser errors for every pair.
The [deployment receipt](../results/evaluation/compatibility-deployment.json) hashes
the public manager, configuration, runtime worker, guard and bridge. The
[Excalidraw supplement](../results/evaluation/compatibility-excalidraw.json)
asserts that the keyboard move changes the saved rectangle coordinate.
The runner restores normal browser storage partitioning through
[`browser-profile.ts`](../test/browser-profile.ts). Test drivers use synthetic
inputs and disposable profiles.

## Original-URL results

| Application | Standalone task | Chromium confinement | Firefox confinement | First blocker |
| --- | --- | --- | --- | --- |
| PhotoCraft | Import a red PNG; paint a black stroke | Task and offline startup | Task and offline startup | None observed for this task |
| Pitch Training | Submit a note-identification answer; retain history | Task, offline reload and history | Task, offline reload and history | None observed for this task |
| Wikipedia | Read article; scroll to final section | Task and offline task | Task and offline task | None observed for this task |
| Squoosh | Open an image; change compression quality | Installation refused | Installation refused | Entry-page CORS |
| Excalidraw | Draw and move a rectangle | Installation refused | Installation refused | Entry-page CORS |
| diagrams.net | Drag a rectangle into a new diagram | Installation refused | Installation refused | CORS fetching conventional `sw.js` |
| StackEdit | Write Markdown; render a preview heading | Installation refused | Installation refused | Entry-page CORS |
| CyberChef | Convert synthetic input to Base64 | Installation refused | Installation refused | Inert inline script data block rejected |

Each standalone task succeeds in both browsers. A successful standalone control
establishes that the chosen task works in the test environment; installation
refusal records the earliest host-side failure rather than a failure of the app.

PhotoCraft receives a generated 256 × 256 PNG through a file-drop event. The test
samples the rendered screenshot at the stroke location before and after painting:
its pixel changes from opaque red to opaque black. Task screenshots retain the
opened document and stroke before offline reload. The reload check establishes
that the editor starts offline; it does not claim that an unsaved document
persists.

Pitch Training's test submits an answer and compares the application's stored
history before and after reload, then repeats the comparison after an offline
reload. It does not evaluate microphone exercises or auditory accuracy.
Wikipedia's test navigates within the document by scrolling to its final section;
it does not claim that other articles are captured. Exports are outside these
chosen tasks and were not measured.

## Failure classification

Squoosh and StackEdit omit an `Access-Control-Allow-Origin` response header for
requests from the host. Excalidraw returns a header permitting its own origin.
The browser therefore refuses the entry-page download. These results say nothing
about how their code would behave after successful admission.

diagrams.net's entry download proceeds, but the importer also requests the
conventional `sw.js` location. The browser refuses that response under CORS. This
is distinct from demonstrating that diagrams.net requires a publisher worker to
execute inside confinement; no confined application code runs in this case.

CyberChef's HTML contains an `application/ld+json` script element. The importer
accepts executable JavaScript script types but rejects this data block. Preserving
inert script data is a general compatibility candidate that can be tested with a
small independent fixture. Passing that stage would expose later dependency or
runtime requirements; the current receipt does not establish those requirements.

No CORS-relaxed copies were used in this baseline. All four CORS failures remain
in the matrix. A separate, clearly identified static-copy experiment could measure
their runtime compatibility without changing this original-URL result.

## Reproduce

Run `node test/evaluation-compatibility.ts` from the repository. `HOST_URL` selects
the host; `EVALUATION_TARGET` selects one of the eight fixed target IDs;
`EVALUATION_RESULTS` selects the receipt path. The test saves stage failures and
continues through the entire corpus. It uses actual browser CORS enforcement and
does not install a request proxy or intercept responses to grant access.
