# Paused child startup during a controller update

The separate [local guard matrix](LOCAL-GUARD.md) now exercises actual controller
upgrade before publication in both browsers. The older server-response experiment
below remains exploratory and is not its CI entry point.

Run from the repository root with the existing built manager, runtime and
installation artifacts:

```sh
node formal/startup/run.ts
```

This is an exploratory, incomplete Chromium characterization, **not a CI gate**.
The intended assertion is that an ordinary child starts, a second child's held
response times out before replacement activation, and that second child neither
executes its application probe nor exposes a Window through its retained iframe.
The latest run did not obtain the replacement activation trace by its verification
checkpoint and exited unsuccessfully. An earlier diagnostic run recorded that
activation after the timeout. The observation/trace-completion timing is not yet
controlled well enough to call this a stable passing test.

The harness bundles the actual production controller source twice with test-only
observation code and different build identifiers. Both versions are served at the
same `sw.js` URL. Production source and generated `dist-*` artifacts are unchanged.
Exact source anchors are checked before adding instrumentation. The injected code:

- Records real native FetchEvent client IDs, reserved resulting-client IDs,
  request destinations and `isTrusted` values.
- Wraps the actual ContextRegistry.bind method to record its outcome.
- Holds one actual child guard-script request for a bounded interval.
- Records controller activation and retains trace rows across replacement.
- Accepts trace/gate commands only after the production checks authenticate an
  actual manager browser client and its controller-issued role.

There is no application-callable observer global or privileged test RPC based on
a claimed URL or client ID. The application fixture retains its own iframe and
reports selected prepared features when its child script starts. These fixture
reports are behavioral witnesses for this fixed source, not authoritative proof
that every guard postcondition holds.

The control child must execute with an exposed, prepared Window. The second child
must initially return a null contentWindow. The trusted manager requests a
same-URL native controller update while the old guard FetchEvent remains held.
After the update is confirmed, the harness checks the durable trace and retained
iframe reference. Each successful binding must correspond to a real native
reserved-client FetchEvent, and no successful binding may duplicate a browser
client in the observed trace. An independent HTTP receiver is calibrated before
the confined phase; the normal child also attempts a synthetic request to it. The latest run recorded
no requests during the confined phase before its trace-check failure.

The earlier diagnostic Chromium sequence was: old controller holds the guard response; the
bounded gate times out; the replacement controller activates afterward; the
pending child does not run. This does **not** exercise replacement activation
while that response remains successfully held. The original survival expectation
failed and is retained in `results-initial-timeout.json` and
`results-upgrade-before-release-timeout.json`. The latter records the decisive
trace, including the ordinary control child.

`results.json` and `results-incomplete-activation-trace.json` record the latest
failed characterization, exact input/bundle hashes,
production artifact provenance, native trace, receiver observations and selected
Window witnesses. The runner closes all browsers and test HTTP servers on exit.
The observation cache lives only in its fresh browser context. The current fixture
uses ports 4210, 4211 and 4219 plus random publisher/receiver ports.

The following remain untested here: Firefox; a pause inside the trusted child
guard after its HTTP response completes; upgrade before actual publication;
late callbacks after cancellation; worker/worklet/popup startup; an early
publication fault control; installation-generation replacement; and a complete
model refinement. The bounded gate failure is an availability observation, not a
confidentiality counterexample.
