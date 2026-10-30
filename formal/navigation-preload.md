# Navigation preload authority

Run `node formal/navigation-preload-probe.ts` after building the host components.
The [receipt](evidence/navigation-preload.json) records browser versions, build
provenance, native receiver observations and virtual-interface outcomes.

The native control registers a service worker on a loopback publisher origin.
A controlled navigation returns a synthetic worker response. With preload
disabled, it causes no receiver request. After enabling preload and assigning a
unique header value, repeating the navigation sends that header to the publisher
server in Chromium 153 and Firefox 155. The handler awaits the preload response
before returning its synthetic response, so the receiver observation calibrates
this specific native route.

A separate app is installed through the host and starts a virtual publisher.
In both browsers, the window's virtual registration and the publisher worker's
virtual registration report preload disabled. Attempts to enable it or set a
header raise `NotSupportedError` in both contexts. The publisher runs in a
shared worker.

The native registration belongs to the publisher origin, not the runtime origin.
This test does not seed runtime-origin preload state, test a confined app's
ability to trigger a navigation when such state is already enabled, or prove
that every route to a native registration is closed. The selected virtual calls
are not a receiver test of all browser-generated navigation requests.
