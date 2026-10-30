# Navigation cancellation fault control

Run `node formal/navigation-preload-fault.ts` after installing Playwright Chromium
and Firefox. The fixture builds the actual window preparation and generated
response policy twice. One isolated test bundle removes only the cancellation
of cross-document Navigation API events. The mutation requires a unique source
anchor and never edits production code.

A fixture service worker has navigation preload deliberately enabled. Its fetch
handler returns a synthetic response for the marker-bearing destination. A native
navigation nevertheless reaches the local HTTP receiver through preload, carrying
the configured preload header. The ordinary prepared window cancels the same
kind of navigation: neither a marker request nor its navigation event reaches
the worker. In the altered prepared window, the marker reaches the receiver and
the worker observes the navigation. Chromium and Firefox both pass these
assertions. Generated CSP and Connection Allowlist headers remain present.

The [receipt](evidence/navigation-preload-fault.json) records source and bundle
hashes, browser versions, synthetic markers, headers and receiver observations.
This establishes sensitivity to a missing navigation defense under deliberately
enabled preload. It does not demonstrate an escape from the production build,
prove a publisher can enable native preload, or cover every navigation and
lifecycle. The receiver and service worker are local test infrastructure.
