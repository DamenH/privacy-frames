# Completion audit

The current context/prototype compatibility batch is not a completed release.
Source implementations and local receipts exist, but final regressions, the
unchanged-app corpus, independent network checks and public deployment remain
pending.

| Agreed work                  | Current state                                                                                              | Completion evidence still required                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Separate installation origin | Authenticated disposable installer, cross-tab serialization and independent runtime admission implemented  | Final regression and public three-origin installation                |
| Retain partial captures      | Ordinary failures recorded; successful resources retained; required entry/preparation/limits still checked | Final partial-capture and application task results                   |
| Prepared execution contexts  | Dedicated/shared workers, worklets, child HTML/SVG and popups implemented                                  | Final recursive/lifecycle/authority regressions                      |
| Prototype compatibility      | Explicit private trusted data; reviewed public language extensions and metadata supported                  | Final hostile interception controls and unchanged application tasks  |
| Native markup check          | Viewless browser parser validates actual nodes before insertion                                            | Final parser/context regressions                                     |
| Fixed eight-app corpus       | Task fixtures and intermediate receipts retained                                                           | Final two-browser task/offline matrix, including failures            |
| Network confinement          | Exact local graph, API gates and CSP retained                                                              | Fresh calibrated DNS/HTTP/TCP/UDP observations on final artifacts    |
| GitHub Pages delivery        | Manager/runtime/installer build roles configured                                                           | Deployment hashes and fresh public behavior checks                   |
| Report                       | Revision in progress                                                                                       | Review against final receipts and paragraph-by-paragraph prose check |

No current completion claim follows from an app installing or an intermediate
fixture passing. CyberChef cancellation/restart in Firefox remains unverified,
including failures of its native control. Desktop PWA installation, WebKit and
real-device mobile behavior need their own evidence.

## Previous release

The earlier completed release tested host source
`84d87c224324a67402997cd39d70e0281132912a`, runtime publisher
`d74e8316d4cf5daa756c00f808e45fae080e7a19` and application publisher
`b8ce7bca6681bc1dd42ee24a783f1555692c03b0`. Its receipt set is retained in
`results/release.json` and the corresponding evaluation records.

Its host workflow was [40450127518](https://github.com/privacy-frames/host/actions/runs/40450127518),
runtime workflow [40450160258](https://github.com/privacy-frames/runtime/actions/runs/40450160258)
and publisher workflow [40448128112](https://github.com/privacy-frames/apps/actions/runs/40448128112).
Those deployment and network observations apply to that release. They do not
verify the current context or prototype changes.

Shared-origin browser permissions, general application updates and IFC remain
outside this implementation batch. Browser-process termination, BFCache and every
concurrent replacement schedule have not been established by the existing tests.
