# Completion audit

The tested implementation is `84d87c224324a67402997cd39d70e0281132912a`.
The runtime publisher pins it at `d74e8316d4cf5daa756c00f808e45fae080e7a19`;
application publishers use `b8ce7bca6681bc1dd42ee24a783f1555692c03b0`.
Later documentation and receipt commits do not change build inputs.

| Agreed work | Evidence inspected | Result |
| --- | --- | --- |
| Three organization repositories | Live GitHub repository/Pages API records in `results/evaluation/migration.json`; runtime and publisher source pins | `host`, `runtime`, `apps` are public; implementation and maintained publisher source are separate |
| Separate trusted origins, Pages hosting and runtime cutover | TLS verification, 51 exact public asset hashes, final public installation/storage/embedding checks, native desktop PWA tests | Manager `pf.damenh.com`, runtime `apps.pf.damenh.com`, unrestricted publishers `privacy-frames.github.io/apps/`; old runtime DNS and six redundant Workers retired |
| Licensed CORS copies | Publisher inventories, licenses/notices, SHA-pinned release locks, distributed corresponding sources, 25-file Pages audit and final standalone tasks | Four copies published; all eight selected tasks pass standalone in both browsers |
| Confinement review | Primary source review, independent defensive evidence audit, 42 unit tests, two-browser hostile/storage/management tests, conversion/data-block and controller-replacement regressions | All named review areas assessed; consistency defects fixed; no new demonstrated disclosure claimed |
| Independent network observations | Fresh CI DNS syscall traces, HTTP/TCP receiver and STUN UDP receiver, active unrestricted controls | Zero private-marker observations on the calibrated routes; controls produced HTTP, STUN and DNS observations in both browsers |
| Fixed compatibility corpus and general fixes | Original-URL baseline, initial Pages matrix, shared-fix matrix and final 16-row release matrix; source/deployment hashes | Six confined task/offline pairs pass; two admitted startup failures and eight refused installations remain visible. No publisher-specific host exception or network fallback added |
| Short report and evidence | Public report bytes, `evaluation/report-review.md`, CI artifacts and `results/release.json` receipt hashes | Report reviewed sentence by sentence, with paragraph endings checked; source and stage provenance retained |
| Future ideas | `evaluation/future-ideas.md` and report permission paragraph | Shared-origin permission choices and publisher-initiated installation recorded; neither implemented |

The final host workflow is [40450127518](https://github.com/privacy-frames/host/actions/runs/40450127518),
the runtime workflow is [40450160258](https://github.com/privacy-frames/runtime/actions/runs/40450160258),
and the publisher workflow is [40448128112](https://github.com/privacy-frames/apps/actions/runs/40448128112).
All completed successfully. Thirteen newly executed CI receipts were retained;
preexisting evidence bundled in that artifact was excluded from the fresh CI set.

The final corpus uses Chromium 153.0.8010.12 and Firefox 155.0 with normal storage
partitioning restored. PhotoCraft's test establishes image editing and offline
startup, not persistence of an unsaved image or export. Wikipedia's task is reading
and scrolling the captured article, not following uncaptured links. Full app
functionality is not inferred from these tasks.

The review is empirical and finite. It is not a confinement proof or an external
penetration test. Initial delegated adversarial reviews produced no findings
because the platform rejected those tasks; the independent review that completed
was a source/evidence audit. Browser-process termination, BFCache and every
concurrent replacement schedule remain unmeasured. WebKit and real-device mobile
installation are unverified. Worker support, IFC and general updates remain future
work. These limits do not change the recorded corpus or turn failed targets into
successful ones.

Changing the runtime origin did not migrate old application data. Reinstall apps
from their public URLs at the new runtime. The old browser-origin storage remains
separate from the new installation list.
