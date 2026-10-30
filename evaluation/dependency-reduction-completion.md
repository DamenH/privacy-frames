# Dependency and enforcement changes

The runtime now supplies a browser Connection Allowlist in addition to its
existing enforcement. DOMPurify was evaluated inside the private context and
retained as a development-only experiment. The local hardening audit removed
unused helpers and identifies the consumers that prevent broader deletions.

## Requirements and evidence

| Work                                          | Result                                                                                                 | Evidence                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Add browser connection restrictions           | Same-origin policy on generated runtime responses; existing blockers retained                          | [Policy and browser limits](connection-allowlist.md), [34 browser rows](../results/trusted-runtime/connection-allowlist.json)   |
| Verify independent enforcement                | Raw browser controls omit CSP and runtime hooks; direct and synthetic document/worker responses tested | Chromium blocks external HTTP/WebSocket and document STUN; Firefox ignores the header                                           |
| Evaluate DOMPurify replacement                | Default, host-policy and contextual adapters run in the actual private context                         | [Experiment and decision](markup-dependency.md), [fixture outputs](../results/dependency-reduction/markup-candidate.json)       |
| Preserve application markup                   | Candidate preserves eight of twelve benign cases; four change in both browsers                         | Keep current validators; DOMPurify is absent from the production graph                                                          |
| Audit local hardening                         | Map protections to actual consumers and movement prerequisites                                         | [Consumer audit](local-hardening-audit.md)                                                                                      |
| Remove supported redundancy                   | Delete unused descriptor helper, private Math copy and duplicate binding names                         | Eight primordial units, deep prepared-child clone with application-modified Math and intrinsic checks                           |
| Preserve confinement and application behavior | Full local suite, trusted-boundary, lifecycle and network checks pass                                  | [Combined eight-app matrix](../results/dependency-reduction/corpus-summary.json) verifies sixteen native/confined/offline pairs |
| Measure actual code                           | Reachable input/dependency bytes -461; eight emitted runtime bundles -1,317 bytes; gzip -282 bytes     | [Stable snapshot](../results/dependency-reduction/size.json), baseline `b8c5b8e08b3ee1a2644924923ad98457e4c0f3f5`               |

The snapshot includes the nested private bundle and its dependencies. The source
removals total 19 lines and 615 bytes; the new response header adds two lines and
154 bytes. Total reachable lines fall by 17. No transport blocker, native markup
validator, context lifecycle check or worklet hardening was removed.

## What the new browser policy does

Generated responses carry `(response-origin); redirects=block; webrtc=block`.
Chromium 153 enforces the tested external-destination and WebRTC restrictions;
Firefox 155 does not. Same-origin network requests and WebSockets remain possible
under this header. An unrestricted native service worker can also relay a
restricted client's request or follow a redirect under its own authority.
The native controller's Pages script response cannot receive the generated
header. Its existing admission, authentication and cache-or-block logic remains
necessary.

The independent fixture tests the publisher executor's SharedWorker browser
class, not its complete RPC adapter. The existing publisher/context suite checks
that integration. WebTransport, every navigation route and worklets are outside
the independent header fixture's observations.

## Why the sanitizer was not adopted

DOMPurify produces passive output for the eight hostile fixtures, but changes
blob image/audio URLs, SVG foreign content and SVG animation. The contextual
adapter fixes table/template losses without fixing those four cases. Accepting
that behavior would reduce compatibility; expanding its policy needs further
analysis. The existing native HTML/XML inspection and context preparation would
still remain. The experiment does not justify adding a second production layer
or claiming its dependencies replace those responsibilities.

## Qualification observations

The initial Chromium Excalidraw installation failed while downloading one
published resource. The browser reported a missing CORS header; a subsequent
request returned HTTP 200 with the expected header. Firefox and an unchanged
Chromium repeat passed. Both receipts are retained, with identical runtime
artifact maps across the runs. The upstream cause is unconfirmed.

The first CI attempt failed on an unhandled WebSocket receiver reset during
control cleanup. The fixture now records expected ECONNRESET/EPIPE shutdown
errors; unknown errors and all marker-traffic assertions still fail the test.
The initial failed run remains [available](https://github.com/privacy-frames/host/actions/runs/41033157953).
A later main CI run failed because an unrestricted WebSocket control observed only
four of six expected handshakes. The receiver now accepts valid handshakes; two
local repeats and the final main CI passed without weakening the zero-traffic
checks. The [failed receipt](../results/dependency-reduction/prototype-ci-failure.json)
is retained.

## Publication

Production source is `bf3ba33df23eecc27c4f94d6a7ca755fde64948c`.
[Main CI and deployment](https://github.com/privacy-frames/host/actions/runs/41035907313)
passed. Runtime and installer publishers pin the same source; their latest Pages
workflows have been requested. Public asset hashes match, but the deployed
application checks have not all passed: several Squoosh and Excalidraw resource
downloads failed during installation. Their cause remains under investigation. Recovery tag `pre-dependency-reduction-2026-10-30` identifies the preceding
qualified implementation at `b8c5b8e08b3ee1a2644924923ad98457e4c0f3f5`.
