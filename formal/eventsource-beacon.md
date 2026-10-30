# EventSource and beacon controls

Run `node formal/eventsource-beacon-probe.ts` after installing Playwright
Chromium and Firefox. The fixture builds the actual window preparation and
response policy. Its independent same-origin HTTP receiver records URLs,
methods and bodies. A separate fixture service worker records fetch events,
serves only setup resources and refuses other requests.

In both tested browsers, an unrestricted EventSource receives a server event,
and an unrestricted `sendBeacon` sends a marker in a POST body to the receiver.
Under the fixture service worker alone, the worker observes and blocks each
request. Under actual window preparation, both calls throw `SecurityError` and
no marker reaches the receiver. An unprepared observer confirms that the worker
intercepted the prepared document request. The [receipt](evidence/eventsource-beacon.json)
records browser versions, source and fixture hashes, outcomes and receiver
observations.

This tests selected same-origin calls in a prepared window. It does not cover
installed-app startup, workers, recovered references, all destinations, or the
effect of removing either denial. The service-worker control does not establish
that every browser-generated request reaches a service worker.
