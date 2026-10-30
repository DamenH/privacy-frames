# Publisher client navigation

Run `node formal/publisher-navigate-probe.ts` after building. The receipt records
the browser versions and source and build provenance. The test uses the
repository's browser profile without additional feature flags.

For the native control, a genuine service worker is registered on a loopback
origin. After a separate window visits a page controlled by that registration,
the worker obtains that client via `clients.matchAll()` and calls
`WindowClient.navigate()` with a unique marker in the URL. Chromium 153 and
Firefox 155 both navigate the client, and the independent HTTP server observes
the marker. The control depends on the worker already having an eligible window
client; it does not show that a confined publisher has a native client.

The test installs an application in the host and starts its virtual publisher.
The publisher obtains its application client through its `clients.matchAll()`
facade and attempts the same navigation. In both browsers it receives one client
whose `navigate` property is undefined, and the attempted call throws TypeError.
The same-runtime-origin marker does not reach the runtime server. An unrestricted
same-origin browser fetch calibrates that server's request recorder.

This covers one existing-window navigation through the virtual publisher's
client facade. It does not prove that all other routes to native clients are
closed, and does not test `clients.openWindow`, cross-origin navigation, other
browser versions, or navigation through other application APIs.
