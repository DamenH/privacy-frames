# Report review

This review covers `REPORT.md` after the evaluation and repository migration
update. The report has 1,276 whitespace-separated words. Its reviewed SHA256 is
`a94478b9e190e8c9f6d67cb6da05163b22b0f28cbd515c6dc90f71998d9d3f22`.

The two-pass review used the [unslop skill](https://github.com/theclaymethod/unslop),
its core contract, rewrite procedure and Crisp Human preset. The first pass
compared claims with the evidence below; the second read every sentence and all
22 paragraph endings. Only the report and this audit were changed by this task.

## Evidence and edits

- `evaluation/compatibility.md` and
  `results/evaluation/compatibility-final.json` establish the recorded corpus
  outcomes: sixteen standalone task controls pass; PhotoCraft, Pitch Training and
  Wikipedia complete their selected confined tasks and offline checks in both
  browsers. PhotoCraft's offline measurement establishes editor startup, not
  persistence of the unsaved edited image. The report uses distinct task wording
  for each application rather than implying that every task is repeated offline.
- `results/evaluation/compatibility-final-baseline.json` records the original CORS
  failures. `evaluation/publisher-packaging.md` describes licensed Pages copies,
  their relocation changes and source hashes. The report distinguishes those
  copies from the three original-URL successes. It retains CyberChef's embedded
  context refusal and identifies preparation and dynamic-script blockers
  without reproducing the matrix.
- `evaluation/security-review.md` and `security-evidence-audit.md` distinguish
  source inspection, calibrated tests and the independent documentation audit.
  The report preserves its experimental scope and absence of a machine-checked
  proof; it makes no new claim of external penetration testing.
- The repository sentence now records `privacy-frames/host`,
  `privacy-frames/runtime` and `privacy-frames/apps` by responsibility. The current
  manager and runtime origins remain `pf.damenh.com` and `apps.pf.damenh.com`.
- The installation paragraph now records the shared source limits of 1,000
  resources and 100 MiB. This is a capacity policy statement, not evidence that a
  previously refused application succeeds after the increase.

The reviewed follow-up corpus receipt identifies host revision
`97d498b6708b48a79f52fd66839b84b8a0849489` and publisher revision
`b8ce7bca6681bc1dd42ee24a783f1555692c03b0`. It contains sixteen successful standalone
controls and six successful confined task/offline checks. Excalidraw now passes
the earlier resource-count stage and fails on its preparation namespace;
Squoosh passes the missing lifecycle-alias stage and reaches the explicit
install-handler requirement. The report summarizes those as preparation blockers
rather than retaining capacity as a current failure. The detailed matrix records
the exact exceptions and original earlier outcomes.

A subsequent preparation-global compatibility edit is outside that receipt.
Its final release corpus rerun was pending at this review. No outcome for that
later edit is inferred here. The report's selected-task results remain explicitly
attributed to the recorded evaluation.

## Protected statements

The following were preserved deliberately: no network fallback; all runtime
applications remain confined; publisher workers never become native controllers;
startup refuses missing navigation enforcement; storage methods and events are
scoped; browser microphone permission grants are shared across the runtime
origin; IFC and application-worker support remain future work.

The corrected storage paragraph is unchanged. Accessible storage APIs and worker
control do not alone establish shared iframe/top-level storage. The report names
the measured same-site deployment and the accessible-but-separate cross-site
partition control.

## Paragraph endings

Each ending contributes a rule, observation, dependency, limitation or evidence
location. None was retained merely to summarize the paragraph.

| Paragraph | Ending purpose | Disposition |
| --- | --- | --- |
| 1 | No network fallback | Preserve the central security rule. |
| 2 | Native JavaScript, DOM, audio and files | Preserve the supported application model. |
| 3 | Malicious behavior examples | Preserve the threat scope. |
| 4 | Paths share an origin | Preserve the reason for distinct domains. |
| 5 | IFC and selective release | Preserve research scope. |
| 6 | 1,000 resources and 100 MiB | Update to actual source policy without inferring compatibility. |
| 7 | Explicit preparation promises | Preserve the completion condition. |
| 8 | Fresh confined document | Preserve separation of public preparation and private execution. |
| 9 | No publisher runtime fetch fallback | Preserve the worker-authority restriction. |
| 10 | Static 404 without worker control | Preserve deployment failure behavior. |
| 11 | Translate aliases before native requests | Preserve enforcement order. |
| 12 | Refuse absent navigation enforcement | Preserve the startup prerequisite. |
| 13 | Surface inventory reference | Preserve the concrete evidence location. |
| 14 | Reject alias collisions | Preserve identity admission behavior. |
| 15 | Permission mediation is future work | Preserve the consequence of shared origin grants. |
| 16 | Management bridge excludes a general proxy | Preserve its capability boundary. |
| 17 | Accessible storage differs from shared partition | Preserve the independently corrected limit. |
| 18 | Publisher manifests cannot add handlers | Preserve the metadata/authority distinction. |
| 19 | Failed targets and first blockers remain in the matrix | Preserve the evaluation's inclusion rule. |
| 20 | Desktop PWA installation | Preserve measurement scope without implying mobile support. |
| 21 | Receipt location | Preserve reproducibility. |
| 22 | Trusted setup required in every worker | Preserve the concrete requirement for future worker support. |

## Scanner validation

The final report was checked with the skill's scanners as prose. Their numerical
word counts tokenize URLs and identifiers differently from `wc -w`.

| Check | Result | Review |
| --- | --- | --- |
| Constraint extraction | 25 candidate constraints in revised text | Used as a cross-check, not a fact verifier. |
| Strict preservation | 19/19 original constraints preserved; no warnings | Pass. |
| Banned phrases | Zero hard or soft violations | Pass. |
| Diff check | 15.1% changed; below 40% threshold | Pass; targeted evidence updates. |
| Structure | Soft sentence-length uniformity warning | Existing in the input; no summary sandwich, conclusion coda, staccato or scaffold opener detected. |
| Silhouette | Soft preview/callback warnings | Existing in the input; manual reading finds the ending states worker requirements rather than repeating the introduction. Repeated security nouns remain precise terminology. |
| Readability | Grade 14.7; terminology repetition and cadence warnings | Advisory for this security-research report. No meaning or enforcement scope was changed to improve the score. |

All script outputs were reviewed. Soft style warnings do not establish a defect
in a particular sentence, and the audit does not claim that every scanner exits
successfully.

## Final release confirmation

The final `84d87c2` corpus completed after this prose review. Its receipt is
`results/evaluation/compatibility-release.json`: all 16 standalone controls and
the same six confined task/offline pairs pass. Excalidraw now proceeds beyond the
namespace write and encounters unsupported script imports during preparation.
The report’s preparation, script-loading and context categories remain accurate;
its frozen text did not require another edit.
