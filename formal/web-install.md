# Browser-managed Web Install requests

[The scoped fixture](web-install-probe.ts) runs with
`node formal/web-install-probe.ts`. It uses ephemeral loopback servers and builds
current runtime preparation source without changing shared build output.
[Its receipt](evidence/web-install.json) records exact browser arguments, source
and bundle hashes, document policies, worker observations and independent HTTP
receiver requests. Native controls use deliberately invalid manifests, so no
application is installed.

Unflagged full Chromium 153.0.8010.12 exposes neither `navigator.install` nor
`HTMLInstallElement`; creating an `install` element produces HTMLUnknownElement.
The experimental comparison uses a temporary persistent browser profile with
`--enable-features=WebAppInstallation` and
`--enable-blink-features=InstallElement`. Restoring background networking is also
explicit. This is an enabled-feature experiment, not default browser support.

| Context with experimental features enabled            | Imperative API                                                           | Declarative element                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Unrestricted native document                          | Marker-bearing manifest GET reaches independent receiver, then DataError | Real pointer click produces marker-bearing manifest GET                         |
| Native document under blocking service worker         | Manifest GET bypasses worker and reaches receiver                        | Manifest GET bypasses worker and reaches receiver                               |
| Actual prepared runtime and generated response policy | SecurityError: API not allowed in sandboxed contexts; no marker HTTP     | `isValid:false`, `invalidReason:illegal_sandbox`; click produces no marker HTTP |

The imperative native call receives user activation through CDP's `userGesture`
option. The declarative control uses an actual Playwright pointer click. Native
declarative controls assert that no manifest request happens before activation.
Each enabled native entry point must deliver its marker to the receiver. Unknown
ordinary requests from controlled pages receive a synthetic refusal from the
fixture worker; the manifest requests are absent from its observations.

The prepared comparison uses same-origin manifest URLs, which satisfy the
runtime's `manifest-src 'self'`. Its failure therefore does not depend on blocking
an external manifest origin. Chromium identifies the active document sandbox as
the reason both entry points are unavailable. The runtime does not currently
need a special-case Web Install replacement to obtain this observed result.

## Primary sources and limits

[The pinned incubation draft](https://github.com/WICG/install-element/blob/8645e61de5af0fadde87db75c99028461585a8a4/index.html)
requires an eligible initiating document with no active sandbox flags. Its
explicit-manifest retrieval occurs before installation consent and skips service
workers, while remaining subject to `manifest-src`. This explains why a user
confirmation dialog would not by itself prevent a manifest URL from carrying
private information.

[Chromium 153's Navigator IDL](https://github.com/chromium/chromium/blob/153.0.8010.12/third_party/blink/renderer/modules/web_install/navigator_web_install.idl)
contains both the newer manifest-options entry point used here and older string
overloads. [Its implementation](https://github.com/chromium/chromium/blob/153.0.8010.12/third_party/blink/renderer/modules/web_install/navigator_web_install.cc)
checks sandbox and activation preconditions before calling the browser install
service. This fixture exercises the manifest-options overload and native element,
not every historical overload or platform installation flow.

The test establishes the observed browser sandbox restriction with a calibrated
manifest-fetch control. It does not establish future browser behavior, every
platform's installation UI, or containment after removing document sandboxing.
No production changes were made.
