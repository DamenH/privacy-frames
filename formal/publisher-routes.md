# Service worker static network routes

Run `node formal/publisher-routes-probe.ts` after building. The receipt records
the browser versions, source and build provenance, and results. No special
feature flag is supplied by this test; it uses the repository's browser profile.

The native control registers a real service worker whose install handler adds a
`network` route for `/routed*`, and whose fetch handler returns a synthetic
response for other requests. In Chromium 153, the routed marker reaches the
publisher HTTP server while the unrouted marker is served by the handler and
does not reach that server. This directly calibrates native routing under these
conditions. Firefox 155 reports that the actual native install event does not
expose `addRoutes`; there is no Firefox positive route control.

The test installs a separate application through the host and launches its
virtual publisher. Its synthetic install event reports `addRoutes` as undefined;
an actual attempted call throws TypeError. The executor reports it is a
SharedWorkerGlobalScope and not a ServiceWorkerGlobalScope. A subsequent
same-runtime-origin marker fetch from the application is not observed by the
runtime server. An unrestricted browser fetch to that server independently
calibrates its request recorder.

This covers the tested static network route and the foreground publisher's
synthetic install event. It does not establish that every route to native
service-worker authority is closed, and it does not test race-network routes,
clients.openWindow, WindowClient.navigate, or every browser configuration.
