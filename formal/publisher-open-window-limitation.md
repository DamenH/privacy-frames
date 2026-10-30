# Clients.openWindow calibration limitation

A native positive control was attempted in Chromium 153 using the repository's
browser profile. A real service worker was registered and activated on a
loopback origin. A Playwright click on a button in its controlled window sent a
message directly to the worker, which immediately called `clients.openWindow`
with a marker URL. The call rejected with `InvalidAccessError`. The attempt was
repeated with the postMessage issued synchronously by the click handler, with
the same result. No activation override or browser flag was used.

This did not establish why Chromium rejected the call, or whether another
legitimate activation path such as a notification click would permit it. The
native positive control was not calibrated, so no paired confinement result is
claimed. The publisher facade currently rejects `clients.openWindow` with
`NotSupportedError`, as covered by the publisher-events unit test; that unit
test does not establish the browser-level receiver behavior or rule out other
routes to native service-worker authority.
