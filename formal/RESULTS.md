# Confinement verification: working results

The target is to prevent an application from causing a remote request or
connection while it handles private input. Installed applications may share
storage and browser permissions; storage namespaces are a compatibility feature,
not a confidentiality guarantee between applications. The detailed assumptions
are in [the threat model](threat-model.md).

## What this work found

A seeded FedCM connection exposed a real conditional escape in the earlier
runtime. `IdentityCredential.disconnect` sent an application-selected marker
to the runtime-origin server outside the service worker. A local fix disables
the identity permission and the relevant static methods. It passed a calibrated
receiver test, the existing browser suite and the local application corpus. The
fix is deployed from host revision `ebc6d0f784dd0943a8342879996e206eed86b271`;
the [finding and reproduction](browser-surface-inventory.md#conditional-fedcm-receiver-finding-and-fix)
describe the prerequisites and checks.

Two registry instances can both accept a binding for the same client in a
deterministic storage-level schedule. The later record wins, and the tested
stale resource capability is refused. Browser reachability and other possible
consequences remain open. The [implementation mapping](implementation-mapping.md#duplicate-binding-dispatcher-reachability-and-consequences)
describes the actual dispatcher checks.

The receiver tests now include a working HTTP/3 WebTransport endpoint and
native hyperlink-auditing and legacy CSP-reporting controls. In the tested
configurations, the prepared environment blocked WebTransport and hyperlink
auditing. Default prepared responses did not emit marker-bearing legacy CSP
reports. With an artificial trusted reporting endpoint, Firefox delivered such a
report outside the service worker. Modern reporting and persisted network-error
logging remain uncalibrated; see the [surface inventory](browser-surface-inventory.md).

## What has been checked

The [bounded models](confinement/README.md) cover selected lifecycle, admission,
registry and generation-read decisions. Their fault and reachability controls
produce expected counterexamples. The [generation model](confinement/generation-reads.md)
also distinguishes a transaction that reads an old generation before replacement
from a later request that tries to read it after replacement.

The registry comparison checks 10,000 sequential operation sequences against a
TLC-generated graph. Separate deterministic tests exercise two registry instances
sharing a storage stand-in. Chromium and Firefox tests exercise real IndexedDB
replacement overlaps and selected network effects with independent receivers.
The [model-to-implementation mapping](implementation-mapping.md) identifies which
code paths correspond to model actions and where that correspondence is missing.

These checks do not compose into a proof that the implementation confines every
browser effect. The abstract models assume that important browser and runtime
mechanisms work as specified; the browser tests cover particular routes, versions
and schedules. A new browser API or an untested use of browser-owned state can
expose an unmodeled channel. The [work plan](PLAN.md) tracks the remaining
correspondence, browser coverage and simplification work.
