# Browser route review queue

This queue makes the bounded [IDL join](../idl-surface-report.md) reviewable one
row at a time. It carries all 263 rows, including unobserved members and earlier
review pointers. It does not classify unreviewed members as safe. The observation
is only a property-name observation in the saved Chromium and Firefox profiles;
it is not evidence of callability, reachability, or a network effect.

```sh
python3 formal/route-review/generate.py
python3 formal/route-review/generate.py --check
python3 formal/route-review/generate.py --check --verify-wpt
```

The first command regenerates `queue.json` offline from the saved IDL report and
`triage.json`. The second detects drift, including changes to either input or the
generator. The third additionally downloads selected Web Platform Tests (WPT)
at the recorded revision and verifies their content hashes. They are examples
for a reviewer, not tests of this runtime. WPT dependencies are not vendored or
verified by this command, and no WPT case is executed.

For each candidate, read the corresponding standard algorithm and identify the
required state, execution context, accessible data, receiver and browser-driven
effects. Record manual classifications and rationale in `triage.json`; select
WPT cases only after examining their relevance. Then design a native success
control and a confined receiver test. Record actual results and their provenance
in the claim ledger, including missing controls and remaining obligations.
Do not convert a source denial, a test name, or a browser property observation
into a security conclusion. The original join's review pointers are retained for
navigation, not promoted to evidence by this queue.

The keys bind a review to an exact specification, interface, member and kind;
all rows sharing that key receive the same review. Occurrence numbers distinguish
duplicate rows in the current report but are not stable across changed input
ordering. The source report does not preserve full overload signatures, so review
all overloads before relying on a classification. `--check` forces inspection
when the input changes, and generation fails if a reviewed key disappears.

This is a queue for 11 selected Webref specifications and two observed context
classes. HTML and CSS algorithms, HTTP headers, browser UI, operating-system
services, other specs, and additional execution contexts need separate inventories.
Completing the queue would not show that the browser has no other channels.

## Reviewed routes

The [service-worker specification](https://w3c.github.io/ServiceWorker/#dom-cache-addall)
shows that `Cache.add` delegates to `addAll`, which fetches HTTP(S) GET
requests before caching. The same algorithm specifies service-workers mode
`none` for a service-worker global. Whether this creates an escape depends on
which native cache and worker contexts an app can acquire and the actual
network controls there. The queue links a pinned WPT case for native behavior.

The [Background Fetch draft](https://wicg.github.io/background-fetch/#dom-backgroundfetchmanager-fetch)
accepts requests with bodies and creates a background operation tied to an active
service-worker registration, subject to permission and request restrictions.
The existing seeded download control is useful evidence for acquisition in its
tested scenario; it is not an upload or prepared-worker reachability result.
[Background Sync](https://wicg.github.io/background-sync/spec/#dom-syncmanager-register)
registers an event rather than itself sending a request. A worker handler and
its network authority are a separate step.

The [navigation preload algorithm](https://w3c.github.io/ServiceWorker/#dom-navigationpreloadmanager-setheadervalue)
stores an application-supplied header value on an active registration. A
subsequent enabled preload could carry that value. Native manager acquisition,
timing and delivery under confinement require receiver tests.

[FedCM getUserInfo](https://w3c-fedid.github.io/FedCM/#dom-identityprovider-getuserinfo)
has several prerequisites, including same-origin configuration, a non-top-level
context and either a connected account or third-party cookie access. The
seeded disconnect experiment does not establish that an installed publisher
can produce those prerequisites on the live runtime. The linked specs are
working drafts read on 30 October 2026; they may change. Pinned WPT files are
examples selected from the snapshot, and may reflect different spec revisions.

[WebSocket close](https://websockets.spec.whatwg.org/#dom-websocket-close)
can send a caller-provided reason in a closing handshake, subject to connection
state and length limits. Testing only `send` would miss this way to carry data
if an application obtained a live native socket. Existing receiver evidence
for connection attempts does not independently establish close-reason coverage.
[WebTransport](https://w3c.github.io/webtransport/#dom-webtransport-webtransport)
provides multiple ways to obtain a writable stream or datagram sender from a
session; acquiring an object and actually delivering bytes are separate events.

The [service-worker container](https://w3c.github.io/ServiceWorker/#serviceworkercontainer)
can expose native registration and controller objects. Those references matter
because later operations may update a worker, configure preload, or communicate
with a handler. The queue records those acquisition routes separately from an
outbound request. Likewise, [periodic sync registration](https://wicg.github.io/periodic-background-sync/#dom-periodicsyncmanager-register)
schedules events and requires the receiving worker to have a further means of
communication. Whether an app can reach these native objects remains a runtime
question, not a conclusion drawn from their presence in the native snapshot.

A `Request` or redirect `Response` can carry a URL or headers without sending
anything on construction. The effect occurs when another operation consumes it.
In particular, a synthetic redirect used by a worker or navigation needs its
own consumer and mediation analysis. `Request.keepalive` also calls for a
lifecycle-specific delivery check rather than inference from a normal fetch.
See the [Fetch Standard](https://fetch.spec.whatwg.org/#request-class) and its
[redirect response construction](https://fetch.spec.whatwg.org/#dom-response-redirect).

[Cache lookup and mutation](https://w3c.github.io/ServiceWorker/#cache-interface)
have a different role from `Cache.add`: `match` reads stored responses and
`put` stores supplied responses. Access to host cache objects could affect
integrity or expose shared state even when the lookup itself is not a request.
The [publisher cache probe](../cache-publisher.md) demonstrates a native worker
fetch control and a negative result for a particular virtual publisher scenario;
it does not prove native-worker reachability is impossible or identify which
layer rejected the confined request.

The [credential container](https://w3c.github.io/webappsec-credential-management/#credentialscontainer)
dispatches creation to type-specific mechanisms and interacts with a
user-agent credential store. Its generic methods do not establish a uniform
network behavior. Browser or vendor synchronization, and any effects of
individual credential extensions, remain separate questions. Likewise,
[WebTransport close](https://w3c.github.io/webtransport/#dom-webtransport-close)
accepts close information; what a peer receives must be measured for the
protocol in use before treating it as a data channel.

An incoming [WebTransport bidirectional stream](https://w3c.github.io/webtransport/#dom-webtransport-incomingbidirectionalstreams)
has a writable side as well as a readable side. Thus, review of sending
capabilities must include streams initiated by the peer, not only the app's
`createBidirectionalStream` calls. Whether a confined app can obtain such a
native session or stream still needs an implementation-level test.

The [ReportingObserver methods](https://www.w3.org/TR/reporting-1/#interface-reportingobserver)
control local report observation and are distinct from the browser's report
delivery algorithm. Similarly, a native service-worker registration exposes
workers at different lifecycle states and can schedule unregistration. These
are acquisition, integrity and lifecycle questions; property observations do
not establish an outbound request. Sync tag reads and unregistration affect
browser-owned state and warrant separate shared-origin analysis.

The [Credential Management specification](https://w3c.github.io/webappsec-credential-management/#passwordcredential)
provides two `PasswordCredential` constructor overloads: one takes a form and
one takes data. The current join lacks overload signatures, so its shared review
covers both without claiming identical validation. The resulting password and
federated credential getters expose local credential state; effects of later
storage, browser synchronization or a separate network relay remain open.

[Background Fetch registration properties](https://wicg.github.io/background-fetch/#backgroundfetchregistration)
expose an existing operation's identifier, progress and outcome, with a progress
callback. Whether an app can access a native registration belonging to another
actor is a distinct question from whether reading one of these properties causes
a request. The Request attribute reviews likewise track metadata without treating
its retrieval as delivery; the consuming network operation remains the boundary
to test.

All rows with an observed property name in this bounded snapshot now have a
manual classification. This means their specified role and follow-up questions
were recorded; it does not mean their effects, implementations or confinement
were exhaustively analyzed. The previously unobserved rows were also reviewed against specification
algorithms where possible. Five remain unreviewed because their algorithms or
current applicability need further checking. An unobserved name is not evidence
that a browser lacks the API.
In particular, the snapshot does not enumerate service-worker global objects,
shared workers, worklets or WorkerNavigator, and covers only the recorded
Chromium and Firefox versions.

Several reviews concern [WebTransport scheduling and buffering](https://w3c.github.io/webtransport/#dom-webtransportdatagramswritable-sendorder).
The configuration setters need a reachable transport object; changes may affect
queued transmission or timing, which the current review has not measured. The
static `Response.json` row in the join constructs a response; the inherited
instance body-reading method is distinct and is not covered by that row.

Review of the unobserved rows identified native service-worker operations
that merit focused tests. [`InstallEvent.addRoutes`](https://w3c.github.io/ServiceWorker/#dom-installevent-addroutes)
can configure static sources including network and racing network with the
fetch handler. This requires the relevant native installation authority; no
publisher path to that authority has been demonstrated.
[`Clients.openWindow`](https://w3c.github.io/ServiceWorker/#dom-clients-openwindow)
and [`WindowClient.navigate`](https://w3c.github.io/ServiceWorker/#dom-windowclient-navigate)
can cause navigation given their respective client and activation prerequisites.
A positive native receiver control and a test of actual publisher reachability
are needed before drawing a confinement conclusion.

Body mixin methods expose and consume streams on Request and Response objects.
A response body can already be backed by a network operation, so body reads
should be reviewed alongside request lifecycle and cancellation, not simply
dismissed as local. The pinned IDL does not resolve the mixin's full exposure
for the captured contexts.
