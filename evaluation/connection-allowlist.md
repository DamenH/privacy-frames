# Connection Allowlist

Generated runtime responses now include:

```http
Connection-Allowlist: (response-origin); redirects=block; webrtc=block
```

This permits the response's own origin and requests browser-level redirect and
WebRTC blocking. It is additional enforcement. Existing CSP, native API hooks,
context preparation, controller authentication and admitted-resource checks stay
in place. There is no reporting endpoint or application-controlled allowlist.

## Browser evidence

Run the independent fixture with:

```sh
node --test test/connection-allowlist.test.ts test/response-policy.test.ts
node test/connection-allowlist.ts
```

The [browser receipt](../results/trusted-runtime/connection-allowlist.json) records
ordinary Chromium 153.0.8010.12 and Firefox 155.0. The fixture uses ephemeral
loopback HTTP and UDP receivers. It has no CSP or runtime API wrappers, so those
mechanisms cannot mask an ignored header. Unrestricted controls must reach HTTP,
successful WebSocket handshakes and STUN receivers. Chromium policy checks require
zero external requests, upgrades, TCP connections and document STUN packets.

| Execution context                                 | Chromium, HTTP response                  | Chromium, synthetic SW response          | Firefox        |
| ------------------------------------------------- | ---------------------------------------- | ---------------------------------------- | -------------- |
| Document                                          | External HTTP/WebSocket and STUN blocked | External HTTP/WebSocket and STUN blocked | Header ignored |
| Dedicated worker                                  | External HTTP/WebSocket blocked          | External HTTP/WebSocket blocked          | Header ignored |
| Shared worker                                     | External HTTP/WebSocket blocked          | External HTTP/WebSocket blocked          | Header ignored |
| Publisher executor's SharedWorker execution class | External HTTP/WebSocket blocked          | External HTTP/WebSocket blocked          | Header ignored |

Worker probes start from an unrestricted parent to establish enforcement of the
worker's own response header. The service worker records requests with native
`worker` and `sharedworker` destinations and returns their script responses
synthetically. The publisher row tests that browser execution class; it does not
exercise the complete publisher RPC/lifecycle adapter. Existing publisher tests
remain responsible for that integration.

Local synthetic resource responses continue to work. Same-origin HTTP egress and
WebSocket upgrades also succeed with the header. A runtime-origin allowlist
therefore cannot replace the resource controller or the WebSocket restriction.
It does not isolate applications sharing that origin.

## Service-worker limits

The test proves that Chromium honors the header on service-worker-generated
document and worker responses. GitHub Pages does not need to supply that header
for those responses. The native controller's own `sw.js` is a different case:
the browser fetches its script from Pages, where this project cannot configure
arbitrary response headers. Adding a header to generated application responses
does not restrict the controller's own network context.

An unrestricted test controller can receive a message from the policy-restricted
document and fetch an external URL on its behalf. The fixture observes that
request as a positive control. Production still needs its existing management
authentication and refusal of application-selected network proxies.

Direct-response Chromium contexts reject the same-origin redirect probe. When
the request is intercepted by the unrestricted test service worker, the redirect
target is reached despite the client's `redirects=block` setting. The controller
has its own network authority; this measurement does not establish blanket
redirect blocking for service-worker-mediated fetches.

The Chromium [design description](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/connection_allowlist_design.md)
places intercepted client-request checks in Blink and outbound service-worker
requests under the worker's own network restrictions. The WICG
[proposal](https://wicg.github.io/connection-allowlists/) defines the header and
the independent context policies. Those documents describe the intended scope;
the receipt identifies the behavior tested here.

These checks cover HTTP, WebSocket and STUN routes in the named contexts. They do
not measure WebTransport, DNS hints, all navigation paths, worklets or a public
deployment. Firefox confinement continues to depend on the existing enforcement.
