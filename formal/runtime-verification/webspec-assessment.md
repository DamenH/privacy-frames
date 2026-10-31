# WebSpec assessment for browser-owned update requests

The unmodified WebSpec model does not discharge our C4 update obligation. This
assessment reviews upstream revision
`b7ff6b714b3a4b572c108cc3136506da3d263eff` against the concrete
[worker-update counterexample](service-worker-maintenance.md).

Run `node formal/runtime-verification/webspec-assessment.ts`. The runner downloads
three pinned upstream files, checks their digests and records the reviewed state
fields and transition names in [the receipt](webspec-assessment.json). Cached
copies are checked against the same digests. This is a reproducible source audit;
it does not run the Coq checker, the solver or WebSpec's browser trace verifier.

In [Browser.v](https://github.com/SecPriv/webspec/blob/b7ff6b714b3a4b572c108cc3136506da3d263eff/model/Browser.v#L458),
the service-worker record contains a version and a response cache. The model's
comments explicitly leave registration out of scope. Its thirteen event
constructors include request/response processing, DOM actions, cookies, storage
and cache operations. The worker-cache update transition changes the response
cache; it is not a service-worker script update. Registration identity, age,
unregistration and the update scheduler needed for our observed behavior are
absent from this lifecycle abstraction.

[SWInvariant.v](https://github.com/SecPriv/webspec/blob/b7ff6b714b3a4b572c108cc3136506da3d263eff/model/SWInvariant.v#L33)
compares a rendered response's CSP with the server-provided CSP. That property
does not prohibit a separate network request triggered by local resource delivery.
Using its existing query as a confinement check would test a different property.

WebSpec remains relevant to scoped questions about response policies and
inheritance. For C4, using it would require additional registration and update
semantics, an observation model, and correspondence to the tested browsers. The
native experiments already show behavior those added semantics must account for.
Keep the direct implementation verifier and this browser-model coverage question
as separate obligations.
