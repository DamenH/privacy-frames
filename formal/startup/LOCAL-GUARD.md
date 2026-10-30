# Controller upgrade before child publication

Run from the repository root after the normal build:

```sh
node formal/startup/local-run.ts
```

The local matrix passes in Chromium 153.0.8010.12 and Firefox 155.0. It is separate
from the earlier, incomplete server-response pause in `run.ts`.

The runner bundles the actual controller and child-guard sources with test-only
instrumentation. It does not modify production source or `dist-*` artifacts. The
child guard pauses immediately after `await waitForShell()`: local preparation,
admission and compilation have completed, but the original guarded notification,
private parent handshake, publication and application rendering have not occurred.
Its HTTP response has finished, so a held old FetchEvent no longer prevents
controller activation.

Each browser runs two schedules in fresh browser contexts:

1. Hold the prepared child, confirm its retained iframe exposes no Window and its
   application probe has not run, activate controller B at the same `sw.js` URL,
   confirm those observations again, then release the child. The original handshake
   completes and its application probe observes a published, prepared Window.
2. Release the prepared child and wait for its probe **before** updating the
   controller. The same upgrade-before-publication ordering classifier must reject
   this actual early-release schedule. This calibrates the classifier; it is not an
   unsafe-publication security fault.

Native controllerchange is observed in the trusted bridge, then a manager RPC
confirms that controller B handles requests. This avoids relying on completion of
an asynchronous activation-trace write. Successful context binds must match real
trusted FetchEvents' reserved resulting-client IDs and request URLs; successful
bindings must be unique in each observed trace. A separately calibrated HTTP
receiver records no confined requests.

## Authority and reentrancy

`local-guard.ts` captures native operations before application execution. Its only
release mechanism is an empty synthetic event dispatched by the test harness into
the hidden child using Playwright's existing Frame handle. It exposes no global
resume function, MessagePort, native constructor, manager role or control object
to the application. A DOM attribute carries only context ID and pause time.

The listener accepts no payload and invokes no supplied callback. It sets its
private settled flag, removes itself and the marker, clears its timer, then
resolves a captured native Promise with undefined. Repeated/reentrant dispatch
cannot resume twice. Application execution resumes through the existing private
parent protocol in a later continuation, rather than inside the release callback.
The eight-second timeout performs the same cleanup and rejects startup; the
production failure path handles the rejection.

A Window-reference holder could release only an already-prepared realm. Release
cannot skip preparation, forge the original source/origin/parent-token checks or
bypass the factory's publication/identity checks. The test does not treat the
event name as a secret. It relies on the existing unpublished-Window boundary and
explicitly checks that the application-retained iframe has no Window before
release. No test channel carries an early Window reference to the parent.

Controller trace commands reuse the observer's actual manager-client and issued
role checks. Application URLs or supplied client IDs do not grant that role.

## Evidence and scope

`local-results.json` records all four schedules, browser versions, production
artifact provenance, source/observer/gate/bundle hashes, actual FetchEvent and
binding traces, timing witnesses, classifier decisions and receiver observations.
`local-initial-missing-trace.json` preserves an initial instrumentation failure:
the native schedule and probe checks succeeded, but the runner had omitted its
completed-response trace hook. The fresh matrix includes that hook.

The fixture's known application code reports selected prepared features and
whether its parent can access its Window. These are behavioral witnesses, not a
complete guard postcondition proof or a TLA+ refinement. This matrix does not test
installation-generation replacement, canceled late callbacks, native worker or
popup startup, all Window-reference paths, arbitrary browser network agents, or
an actual early-unprepared-execution fault. Instrumentation adds scheduling points.

The runner closes its browsers and HTTP servers on success or failure. It uses
ports 4210, 4211 and 4219 plus random publisher/receiver ports. Trace caches exist
only in fresh test browser contexts. Neither the event listener nor its DOM marker
survives into the application's execution.
