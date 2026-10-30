# WebSocket denial fault control

Run `node formal/websocket-fault-probe.ts` after installing Playwright Chromium
and Firefox. The fixture builds actual window-preparation code and generated
response headers without changing production source or shared build artifacts.
Its test-only build removes exactly one anchored `WebSocket` entry from the
effect-policy deny list. The build refuses to proceed if that anchor is absent or
appears more than once.

An independent loopback HTTP server implements a successful WebSocket upgrade.
For each browser, an unprepared page must open a native socket to the same-origin
receiver. A normally prepared page must reject its attempt with `SecurityError`
and no matching upgrade. The mutated prepared page must open a socket and send
its synthetic marker in the upgrade URL. The generated CSP and Connection
Allowlist headers are asserted in both prepared cases; the service worker logs
both page requests but no WebSocket upgrade. Thus the mutation demonstrates a
same-origin route that those other tested layers did not block.

[The receipt](evidence/websocket-fault.json) records browser versions, source,
runner and bundle hashes, request headers and receiver observations. The
`completed` field is true only if all assertions pass. These are selected
same-origin window tests, not an installed-app or full-browser confinement proof.
Firefox's receipt also does not establish that it enforces Connection Allowlist;
the assertion establishes only that the response carried the header.
