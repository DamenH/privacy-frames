# Message-based local resource delivery

The prototype supplies cached resources to a classic Blob worker over message
channels while CSP denies native HTTP. It works in the six tested configurations:
Chromium, Firefox, and Firefox with the forced-stale check, each with the service
worker registered or unregistered. This tests a transport candidate rather than
replacing the production runtime.

Run `node formal/runtime-verification/message-resource-broker.ts`. Repeat with
`PF_BROKER_RELAX_CSP=1` for the relaxed-policy control. The
[strict receipt](message-resource-broker.json) and
[control receipt](message-resource-broker-relaxed.json) record browser versions,
source hashes, receiver observations and lifecycle results.

## Mechanism and checks

A trusted service worker seeds resources in Cache Storage during setup. A trusted
page retains its native service-worker handle and relays read requests from the
application worker. Each read transfers a fresh reply port to the service worker.
The broker either transfers cached bytes and their content type or returns an
error. It never calls `fetch()` for a missing resource.

The worker starts from a trusted Blob prefix. That prefix installs the message
adapter before importing the application's unchanged classic script from another
Blob. The application uses ordinary `fetch()` calls and receives native `Response`
objects. The fixture checks concurrent JSON reads, binary bytes, Wasm
`instantiateStreaming`, missing-resource refusal and refusal of a foreign URL.
Deleting an admitted cache entry causes a local read error with no HTTP request.
The trusted test harness then restores the entry before the restart check.

The strict policy uses `connect-src 'none'`. A native XHR attempt fails while
broker reads succeed, with no HTTP requests observed during the action and the
three subsequent seconds. An unrestricted worker XHR first reaches the independent
server. Relaxing only the prototype's connect policy to `'self'` then lets the
application's native XHR reach that server in every configuration. This is a
control on the prototype policy, not removal of a production runtime guard.

Chromium also passes after a confirmed service-worker-global restart. The fixture
uses a version-specific stop command, observes `stopped` followed by `running`,
and requires a changed per-global instance token. The application's next read
wakes the worker and returns the cached data without an HTTP request. A debugging
target can survive this lifecycle; target closure is not the restart criterion.
Equivalent Firefox termination control remains unestablished.

## Remaining integration work

The prototype supports string GET requests and buffers complete resource bodies.
It does not preserve the full Fetch API contract or establish immutable admission,
management authentication, revocation, prototype safety or every native effect
restriction. Its trusted page is a test harness, not an application-facing host.

Integration would need private broker grants tied to actual installation and
context authority, resource-generation checks, and preparation before every
application context starts. Ordinary module graphs, synchronous classic imports,
DOM/CSS resources, shared workers and publisher executors still need local
delivery contracts. The Firefox document-update finding remains unresolved.
Keep the production C4 claim open until those paths have implementation evidence.
