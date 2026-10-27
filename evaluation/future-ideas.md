# Future design questions

## Browser permissions across applications

Installed applications share the runtime origin, so browser permission grants
such as microphone access are not automatically scoped to an individual
installation. Application-scoped storage does not isolate these grants.

Consider three approaches:

- Mediate permission-bearing browser APIs through trusted wrappers, maintaining
  per-application authorization in addition to the browser's origin permission.
- Accept shared browser permissions and explain that behavior to the user.
- Give each installed application a unique subdomain, allowing the browser to
  distinguish their origins. This would also change runtime hosting, service-worker
  registration, storage and management communication.

Permission isolation is future work, outside the current migration and evaluation.
Current permission tests establish browser behavior and functionality, not
per-application permission isolation.

## Publisher-initiated installation

A publisher could link to an installation request on the trusted manager. The
user would approve installation there; the publisher would receive no management
authority. This idea is outside the current implementation.
