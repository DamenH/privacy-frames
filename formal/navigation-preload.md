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
After startup, a trusted same-origin test page deliberately enables preload on
the native runtime registration and sets a distinct header. In both browsers,
the window's virtual registration and the publisher worker's virtual registration
still report preload disabled. Attempts to enable it or set a header raise
`NotSupportedError` in both contexts, and the native enabled state and header
remain unchanged. The publisher runs in a shared worker. The test resets the
native state afterward.

With preload still enabled, the app makes a programmatic link click and calls
`location.assign` with a marker in a same-origin query. Neither changes the
app URL or produces a marker-bearing runtime-server request during the 500 ms
observation in either browser. An out-of-page request separately confirms that
the runtime server's recorder can receive a marker. These are selected
synthetic attempts, not tests of physical user actions or every navigation path.

The native receiver control uses the publisher origin. Runtime-origin preload
state is seeded artificially after startup; this is not evidence that a publisher
can create that state. The test does not prove that every route to a native
registration is closed or cover all browser-generated navigation requests.
