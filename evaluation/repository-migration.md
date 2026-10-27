# Repository migration

The agreed organization layout is `privacy-frames/host`, `privacy-frames/runtime`
and `privacy-frames/apps`. Transfer the implementation repository to `host` and
rename the existing deployment repository to `runtime`. Keep runtime source and
enforcement tests together in `host`; `runtime` publishes a pinned source revision.
Move maintained examples and licensed publisher snapshots into `apps`, retaining
external catalog entries for applications that need no mirror.

The manager stays at `https://pf.damenh.com/`. The runtime moves to
`https://apps.pf.damenh.com/`. Unrestricted publishers use
`https://privacy-frames.github.io/apps/`. All three sites use GitHub Pages.
The manager and runtime retain separate origins within the same site, preserving
how the bridge and top-level applications access installation storage.

Verify installation, storage, offline execution and management authentication at
the new runtime before retiring `pf-apps.damenh.com`. Existing installations and
private application data remain stored under the old origin; changing DNS does
not migrate browser storage. Tell users to export data from the old installation
where supported before reinstalling at the new runtime.

Publisher self-installation is an idea for later work, outside this implementation.
A publisher could link to an installation request on the trusted manager, with
user approval, without receiving management authority. The current bridge accepts
requests only from configured manager origins and the real parent window. The
worker also requires a management role bound to a trusted bridge document's
browser client ID.
