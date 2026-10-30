# Native WebSocket control lifetime

The host publication [run 41130688846](https://github.com/privacy-frames/host/actions/runs/41130688846)
stopped in the native Chromium case of `test/prototype-confinement.ts`, before
running a confined case. The receiver recorded five of the six named socket
controls. The missing `record-microtask` control had returned from construction
according to the application report, but its upgrade did not reach the server
within the test's deadline. The saved receipt does not establish why it was missing.

The fixture created a child with `srcdoc` and attempted socket connections from
its initial document while that navigation was pending. This introduced a
lifetime hazard into the positive control: the
[WebSockets document-cleanup rules](https://websockets.spec.whatwg.org/#garbage-collection)
require an unestablished connection to fail when its document goes away.
Constructor success alone cannot calibrate that receiver path.

The fixture now keeps its native child at `about:blank` throughout the controls.
It waits for every named receiver observation, rather than a count that could
also include duplicates. The same six observations remain required, and timeout
failures identify the missing name. All confined assertions still require denied
constructors, hidden pending references and zero receiver upgrades.

The revised test passed three consecutive local executions in Chromium and
Firefox, followed by the full host publication
[run 41132188326](https://github.com/privacy-frames/host/actions/runs/41132188326).
The [latest full receipt](evidence/contexts-prototype-confinement.json)
records each native handshake and the confined results. These checks cover a
stable blank child's references; document-navigation transitions have separate
fixtures, including [context-navigation.ts](../test/context-navigation.ts) and
[document-contexts.ts](../test/document-contexts.ts).
