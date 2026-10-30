# Experimental Web Install sandbox fault

Run `node formal/web-install-sandbox-fault.ts` after installing Playwright
Chromium. The fixture uses a temporary full-Chromium profile with the
experimental Web Install API and install-element features explicitly enabled.
Its invalid manifest responses prevent actual installation. Current default
Chromium does not expose these features in the tested profile.

The fault is applied only to the test server's generated response: it removes
the CSP sandbox directive at a single asserted anchor. Application preparation,
the service worker, `manifest-src 'self'`, `connect-src 'self'` and the
Connection Allowlist header remain unchanged. The test compares the resulting
policy with the normal prepared response and checks that the blocking worker
observes the fault page.

Native controls require marker-bearing same-origin manifest requests from both
`navigator.install` and an activated install element. Normal prepared attempts
must reach no receiver and report sandbox denial. Both fault-page attempts must
reach the independent HTTP receiver; the worker must not observe their manifest
requests. The [receipt](evidence/web-install-sandbox-fault.json) records the
browser, flags, source and bundle hashes, headers and receiver observations. Its
`completed` flag is set only after every assertion passes.

This establishes the importance of the sandbox in these two tested entry points
under an explicitly enabled experimental Chromium profile. It does not establish
behavior for default Chromium, other browsers, older overloads or installed apps
running through every host path.
