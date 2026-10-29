# Trusted runtime completion

Applications keep native JavaScript, DOM objects, event handling, workers and
WebAssembly. Our document compiler, fragment preparation and markup validation
run in a private iframe with independent intrinsics. The frame is created before
application execution, its callable stays in a bootstrap closure, and requests
and replies contain strings. Foreign objects and errors cannot cross that interface.

This implements the corrected [plan](realm-runtime-plan.md). The earlier design
put application code inside ShadowRealm and recreated browser interfaces. The user
replaced that requirement with isolating our code. Production now has one private
iframe implementation; native ShadowRealm is a research control and Near Membrane
is a research dependency.

## Release

| Role                  | Revision                                   | Deployment                                              |
| --------------------- | ------------------------------------------ | ------------------------------------------------------- |
| Qualified host source | `b8c5b8e08b3ee1a2644924923ad98457e4c0f3f5` | [pf.damenh.com](https://pf.damenh.com/)                 |
| Runtime publisher     | `09e57aed3b22d7f9e339b87e7b51ba1e03d0e679` | [apps.pf.damenh.com](https://apps.pf.damenh.com/)       |
| Installer publisher   | `93147b06fcad9fd22c4c7a48ca93c47acc474173` | [install.pf.damenh.com](https://install.pf.damenh.com/) |
| Application catalog   | `b8637f0dc5b5e56ae0b6397fdae8501598b7d39e` | [GitHub Pages](https://privacy-frames.github.io/apps/)  |

Both deployment repositories pin the qualified host source. All sites remain on
GitHub Pages. [Host CI and publication](https://github.com/privacy-frames/host/actions/runs/40971156838),
[runtime publication](https://github.com/privacy-frames/runtime/actions/runs/40971625813),
[installer publication](https://github.com/privacy-frames/installation/actions/runs/40971631286)
and [catalog publication](https://github.com/privacy-frames/apps/actions/runs/40965282246)
passed. The recovery tag `pre-realm-runtime-2026-10-29` preserves previous main
`1a78033b48a64b72cd21b4467b96e7c7eba6a2f1`; deployment pins are also recorded
in [the recovery receipt](realm-recovery.json).

## Boundary and retained code

The host and existing service worker retain management, admission, context
authorization and admitted resource delivery. Document parsing and preparation
move behind the private text interface. Actual DOM access, native calls,
synchronous cancellation, JavaScript import relocation and worker/worklet hooks
remain local where moving them would change browser semantics. Their native
captures and hardening remain necessary. The runtime reuses Acorn for import
analysis; the installer retains its existing lexer.

The private iframe is detached before application code starts. Reference
containment is essential: a same-origin frame whose Window became accessible
would not protect its state. The boundary fixture includes an unrestricted control
that recovers a deliberately exposed frame, then probes the real guarded setup
through Window properties, coercion, prototype hooks, errors and stack data.
No foreign frame, object or callable was recovered in those tested routes.

No network fallback, publisher-specific runtime branches or third-party source
patches were added. Installation still downloads without executing publisher code.
The existing resource limits, URL lists, scoped storage and admission checks remain.
The Pitch Training catalog changed because its upstream deployment removed two
old asset filenames; its replacement inventory verifies 41 resources.

## Verification

- Qualified branch CI and main CI passed type checking, formatting, 143 unit tests,
  the full context suite, storage, lifecycle, compatibility, Wasm, Pitch Training
  and independent HTTP/TCP, DNS and STUN network checks in Chromium and Firefox.
- The computation fixture passes with Chromium's native ShadowRealm research
  control and the production iframe in both browsers. Integrated boundary checks
  also pass in both browsers under confined CSP, including native script bindings,
  event cancellation, Wasm and application prototype extension.
- [Public asset verification](../results/assets.json) matched 71 files to the
  tested build and checked uncontrolled paths return 404.
- [Public host checks](../results/deployed.json) installed all eleven examples
  and passed ten behavior/security groups per browser with no captured errors.
- [Public application matrix](../results/trusted-runtime/compatibility-public.json)
  passed native and confined tasks plus offline reopening for all eight
  applications in both browsers. The actual deployment artifact hashes remained
  stable throughout testing.

The matrix covers PhotoCraft, Pitch Training, Wikipedia, Squoosh, Excalidraw,
diagrams.net, StackEdit and CyberChef. Console warnings remain in the raw matrix;
passing tasks do not mean every publisher feature was exercised.

An initial local Firefox CyberChef offline file-processing check timed out.
Both the previous public runtime and an unchanged repeat of the new runtime
passed. The [initial receipt](../results/trusted-runtime/cyberchef-text-file-initial.json)
and [repeat](../results/trusted-runtime/cyberchef-firefox-repeat.json) are retained;
the cause is unconfirmed.

The public Pitch Training check passed six groups in Chromium and five in
Firefox, including audio, microphone, workers and persistence. The deeper public
CyberChef run passed Chromium text/file processing online and offline. Firefox's
confined page crashed in the initial run; a sequential unchanged repeat passed
native, confined and offline processing. A Chromium SVG observation also failed
once online while passing offline; a sequential unchanged repeat passed both.
The [repeat receipt](../results/trusted-runtime/cyberchef-cancel-public-repeat.json)
includes worker cancellation, restart and native SVG animation. Initial receipts remain in
`results/trusted-runtime/*-public-initial.json`; these failures are separate from
the all-green eight-application matrix and their causes remain unconfirmed.

## Size and cost

The [size audit](trusted-runtime-size.md) counts the private bundle and dependencies.
Unique reachable source/dependency bytes fell by 58,411, and eight uncompressed
runtime bundles fell by 345,900 bytes. Source lines increased by 236 and gzip
bytes increased by 28,201. Both window guards removed about 518 KB of locally
executable parser code; that parser remains charged to the private bundle.

The [component measurement](../results/trusted-runtime/performance.json) uses seven
samples per path with matching outputs. Median private-frame setup was 3.9 ms in
Chromium and 13 ms in Firefox. Parsing 1 MiB of script text as data through the
production client took 30.4/51 ms, versus 23.9/36 ms directly. An equivalent local
serialization control took 29.8/47 ms. These measure component overhead, not a
whole-application startup improvement. Physical engine string copies and peak
memory were not measured; application buffers stay native.

## Limits

These checks provide executable evidence, not a proof of exhaustive confinement.
The local enforcement hooks remain security-sensitive. This pass does not establish
per-application browser permission or origin isolation, unrestricted support for
all web APIs, or real-device mobile behavior. Firefox CyberChef cancellation
remains unqualified because its native control has been unstable.
