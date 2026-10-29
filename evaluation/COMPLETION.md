# Historical explicit-resource installer audit

For the current release, see [trusted runtime completion](trusted-runtime-completion.md).
The revisions below describe the previous release. Receipt paths shared with later
runs may now contain newer evidence; use its indexed CI artifact for the historical record.

The explicit-resource installer is deployed on all three trusted origins. No
publisher code runs during installation. Automatic discovery follows HTML/CSS
resource declarations and literal JavaScript imports; optional URL lists supply
other dependencies.

## Source and deployment

| Role                                 | Revision                                   | Site                                                                    |
| ------------------------------------ | ------------------------------------------ | ----------------------------------------------------------------------- |
| Host source                          | `97f2b835609eedc95c9f52a470c7c32046f1b5fb` | [pf.damenh.com](https://pf.damenh.com/)                                 |
| Runtime publisher                    | `234fba3b4469ca243d2208e22b90b62aedaebd25` | [apps.pf.damenh.com](https://apps.pf.damenh.com/)                       |
| Installer publisher                  | `5f460f4b8aca4c87f1512861e269108761ac46b2` | [install.pf.damenh.com](https://install.pf.damenh.com/)                 |
| Application publishers and URL lists | `f5de28d798237921e7d83467e9fa399dbb141b25` | [privacy-frames.github.io/apps](https://privacy-frames.github.io/apps/) |

Both deployment-only repositories pin the host source above. All four
[GitHub Pages workflows](../results/evaluation/explicit-deployments.json) passed.
The [public asset check](../results/assets.json) matched 71 files to the tested
build. The [retired installer worker](../results/evaluation/retired-installer-worker.json)
returns 404.

## Verification

| Requirement                    | Evidence                                                                                                                                                  | Result                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Source checks and regressions  | [Final CI](https://github.com/privacy-frames/host/actions/runs/40858648533), 136 unit tests, core/context suite, storage, lifecycle and functional checks | Passed                             |
| URL-list UI and admission      | CI includes paste/upload/URL selection, malformed lists, required-resource failures, old-format rejection and private-data preservation                   | Passed                             |
| Network confinement            | [Chromium](../results/network.json) and [Firefox](../results/network-firefox.json), with active HTTP/TCP, DNS and STUN controls                           | No measured private-marker traffic |
| Eight applications             | [Public matrix](../results/evaluation/compatibility-explicit-lists-public.json), 16 standalone/confined task and offline pairs                            | Passed                             |
| CyberChef text and files       | [Public native/confined checks](../results/evaluation/cyberchef-text-file-explicit-lists-public.json), both browsers, offline repetition                  | Passed                             |
| CyberChef cancellation and SVG | [Public Chromium checks](../results/evaluation/cyberchef-cancel-explicit-lists-public.json), native control and confined online/offline tasks             | Passed                             |
| Pitch Training                 | [Public checks](../results/pitch-training-deployed.json), both browsers, audio, microphone, worker and persistence checks                                 | Passed                             |
| Host interface                 | [Public checks](../results/deployed.json), all eleven examples installed and ten behavior/security groups per browser                                     | Passed                             |

The [CI receipt index](../results/evaluation/explicit-ci-receipts.json) identifies
43 freshly produced JSON receipts and excludes 83 unchanged historical receipts
from the uploaded artifact. The public matrix recorded stable artifacts before
and after testing. Application source files were unchanged; the publisher commit
adds URL lists and their verification data.

## Simplification

The [committed-source count](../results/evaluation/explicit-installer-code-size.json)
measures 3,027 installer TypeScript lines before this change and 1,129 after it, a 62.7%
reduction. It excludes dependencies, generated bundles, the manager and runtime.
Filename guessing, loader inference, installation-time publisher execution, SES,
preparation receipts and cache contributions were removed.

The public matrix measured installation at 1.07–4.09 seconds in Chromium and
1.06–4.03 seconds in Firefox. A separate [Node comparison](../results/evaluation/explicit-installer-comparison.json)
records CyberChef at 84.3 seconds before and 5.9 seconds after the initial
replacement. That single live-network comparison used different resource graphs
and predates the CSS parser correction; it is not a statistical speedup claim.

Existing resource installations require reinstalling. Private application
storage is separate and is retained. There is one installation format and no
legacy reader.

## Limits

These checks cover selected workflows and browser surfaces, not a formal
confinement proof or every feature of each application. Firefox CyberChef
cancellation remains unverified because the unrestricted native control is
unreliable. WebKit, real-device mobile installation, general updates and strict
per-application origin/permission isolation remain future work. Missing runtime
resources still fail locally without network fallback.

The [previous release ledger](../results/evaluation/release-2dfcbc.json) retains
historical deployment information. It does not verify this release.
