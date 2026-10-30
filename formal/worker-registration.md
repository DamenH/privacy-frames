# Native registration access from dedicated workers

Run `node formal/worker-registration-probe.ts` after building the three host
components and installing Playwright Chromium and Firefox. The test creates a
native registration on a loopback publisher origin, then asks an unrestricted
worker on that origin for registrations. It also installs an app through the
host and asks its real dedicated worker to read `navigator.serviceWorker` and
call the `WorkerNavigator.prototype` getter directly.

Firefox 155's native control obtains the real container and sees the seeded
registration. The installed worker receives `SecurityError` from both getter
routes. Chromium 153 exposes neither getter in this profile; its result is not
a positive control for the guard. The [receipt](evidence/worker-registration.json)
records versions, build provenance and outcomes, and marks the run complete
only after the browser-specific assertions pass.

The native control uses the publisher origin, while the installed worker runs
on the host runtime origin. The test checks these two getter routes in a
selected dedicated worker; it does not establish that every native registration
or background agent is unreachable, and it does not test shared workers,
registration access before preparation, or a background request from the
installed worker.
