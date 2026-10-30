# Cache downloads in the publisher executor

Run `node formal/cache-publisher-probe.ts` after building the runtime. The receipt
`formal/evidence/cache-publisher.json` identifies the test runner, source and
build artifacts. It records only a completed run after every assertion passes.

The [service worker specification](https://w3c.github.io/ServiceWorker/#dom-cache-addall)
specifies that Cache.addAll requests use service-workers mode `none` when the
request client's global is a native ServiceWorkerGlobalScope; Cache.add delegates
to addAll. This is relevant because native service-worker network activity does
not necessarily pass through the host's service worker.

The positive control installs a native service worker on a separate loopback
publisher origin and asks it to run Cache.add with a unique marker. The HTTP
server observes that request. An unrestricted same-origin browser fetch also
confirms the runtime-origin server's request recorder is active.

The test then installs a small publisher application through the actual host and
starts its virtual service worker. Its message handler identifies its global as
SharedWorkerGlobalScope and attempts Cache.addAll to an uninstalled URL on the
runtime's own origin, containing the marker. Both tested browsers report
TypeError and the independent runtime server records no marker request. The
runtime replaces Cache.add and addAll to require installed GET resources. The
publisher executor is a prepared SharedWorker, not a native service worker.

This test does not prove that all native service-worker registrations or globals
are unreachable, nor does it isolate which defense caused the rejection. It does
not test every cache request, browser version, or way to acquire authority. The
native control confirms network reachability from the native worker; it does not
instrument a separate service worker to observe its fetch events. Other tests
cover seeded native registration recovery and dedicated-worker Cache.add.
