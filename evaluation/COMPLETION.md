# Explicit-resource installation: verification in progress

The replacement installer downloads declared resources and optional URL lists
without executing publisher code. Its source and local checks are being verified;
the public manager, runtime and installer still serve the previous release below.
Those historical receipts do not verify the replacement.

# Previous release audit

The implementation is deployed on all three trusted origins. CI and public
artifact checks, the public eight-app matrix and deeper CyberChef/Pitch Training
tests have passed. The general host interface also passed in both browsers.

## Source and deployment

| Role                              | Repository revision                        | Site                                                                    |
| --------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------- |
| Host                              | `2dfcbc2e8be6d9ec64bc3c20789446b59977e14e` | [pf.damenh.com](https://pf.damenh.com/)                                 |
| Runtime publisher                 | `a9c2869408c38330d5b9d8b7031abeeedddf3741` | [apps.pf.damenh.com](https://apps.pf.damenh.com/)                       |
| Installer publisher               | `e8f71e6b9255a8bcb21b4fc0ba599f7aba0fbc05` | [install.pf.damenh.com](https://install.pf.damenh.com/)                 |
| Maintained application publishers | `2c26c40c77160af643ae053115a3975cc5a01ba0` | [privacy-frames.github.io/apps](https://privacy-frames.github.io/apps/) |

The host [CI/deployment run](https://github.com/privacy-frames/host/actions/runs/40763844471)
passed type checking, formatting, 182 unit tests, the full browser regression suite,
security review checks, storage/lifecycle tests, Pitch Training and independent
network tests. [Workflow results](../results/evaluation/final-ci.json) and the
[42 fresh receipt hashes](../results/evaluation/final-ci-receipts.json) identify this
run. Older receipts bundled in its artifact are excluded from that fresh set.

The [runtime workflow](https://github.com/privacy-frames/runtime/actions/runs/40763816951)
and [installer workflow](https://github.com/privacy-frames/installation/actions/runs/40763821000)
also completed. The [public HTTPS asset check](../results/assets.json) matched all
59 checked files against local build hashes, including the three trusted sites.

## Verification status

| Area                                         | Evidence                                                                                                                              | Status                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Installation, admission and partial capture  | Final-source CI tests and public installations of all eight applications                                                              | Passed                                 |
| Contexts, prototype compatibility and markup | Two-browser CI regressions and public useful-task comparison                                                                          | Passed                                 |
| Network controls                             | Calibrated final-source DNS/HTTP/TCP/UDP tests in CI                                                                                  | Passed for measured routes             |
| Eight-app corpus                             | [Public matrix](../results/evaluation/compatibility-release-public.json): all 16 standalone/confined task and offline rows            | Passed                                 |
| Pitch Training                               | [Deployed tests](../results/pitch-training-deployed.json): six Chromium and five Firefox groups, no recorded errors                   | Passed                                 |
| CyberChef text/file tasks                    | [Public tests](../results/evaluation/cyberchef-text-file-release-public.json): both browsers, standalone and confined; offline repeat | Passed                                 |
| CyberChef cancellation/SVG                   | [Public Chromium tests](../results/evaluation/cyberchef-cancel-release-public.json): online/offline with native control               | Passed in Chromium; Firefox unverified |
| General host interface                       | [Public checks](../results/deployed.json): eleven examples installed and ten behavior/security groups in each browser                 | Passed                                 |

The deployment receipt retains one Chromium error from an unsupported optional
precache worker, with browser-native exception attribution and the separate
preparation outcome. Both browsers recorded zero unexpected errors.

The [compatibility evaluation](compatibility.md) defines each selected task and
its offline check. Installation or startup alone does not count as task success.
The [CI compatibility test](../results/compatibility.json) installed and launched
two independent native PWAs through Chromium DevTools, then cold-launched offline
after a full browser restart with saved private state. Firefox did not perform
native PWA installation. Manual desktop installation UI, WebKit and real-device
mobile behavior remain untested.

## Previous release

The earlier completed release tested host source
`84d87c224324a67402997cd39d70e0281132912a`, runtime publisher
`d74e8316d4cf5daa756c00f808e45fae080e7a19` and application publisher
`b8ce7bca6681bc1dd42ee24a783f1555692c03b0`. Its receipt set is retained in
[archived release ledger](../results/evaluation/release-84d87c.json) and the corresponding evaluation records.

Its host workflow was [40450127518](https://github.com/privacy-frames/host/actions/runs/40450127518),
runtime workflow [40450160258](https://github.com/privacy-frames/runtime/actions/runs/40450160258)
and publisher workflow [40448128112](https://github.com/privacy-frames/apps/actions/runs/40448128112).
Those deployment and network observations apply to that release. They do not
verify the current context or prototype changes.

Shared-origin browser permissions, general application updates and IFC remain
outside this implementation batch. Abrupt browser-process loss, BFCache and every
concurrent replacement schedule have not been established by the existing tests.
