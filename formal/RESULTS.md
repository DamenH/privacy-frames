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
fix was first deployed from host revision `ebc6d0f784dd0943a8342879996e206eed86b271`;
the [finding and reproduction](browser-surface-inventory.md#conditional-fedcm-receiver-finding-and-fix)
describe the prerequisites and checks.

Two registry instances can both accept a binding for the same client in a
deterministic storage-level schedule. The later record wins, and the tested
stale resource capability is refused. Browser reachability and other possible
consequences remain open. The [implementation mapping](implementation-mapping.md#duplicate-binding-dispatcher-reachability-and-consequences)
describes the actual dispatcher checks.

An [exploratory controller-update fixture](startup/README.md) observed a child
remaining unpublished while its guard response was held. One run recorded the
response timing out before the replacement controller activated; a later run did
not capture the expected activation trace. The fixture is not a passing check of
upgrade before publication and is not part of CI.
A separate [test-only guard pause](startup/LOCAL-GUARD.md) passed the intended
upgrade-before-publication schedule in Chromium and Firefox, with an early-release
ordering control. It covers those instrumented schedules, not every interleaving.
The [partial trace comparison](startup/LIFECYCLE-PROJECTION.md) maps these four
observed schedules to the TLC lifecycle graph, with root startup and child
publication explicitly inferred. It rejects 30 deliberately faulty projections.

The receiver tests now include a working HTTP/3 WebTransport endpoint and
native hyperlink-auditing and legacy CSP-reporting controls. In the tested
configurations, the prepared environment blocked WebTransport and hyperlink
auditing. Default prepared responses did not emit marker-bearing legacy CSP
reports. With an artificial trusted reporting endpoint, Firefox delivered such a
report outside the service worker. Full Chromium also sent a modern CSP report
under a test-injected trusted reporting configuration. A deliberately persisted
NEL policy produced no application-marker traffic in the tested prepared case,
with working before-and-after delivery controls. The [surface inventory](browser-surface-inventory.md)
records the configurations and remaining gaps.
The [background-agent probe](background-agents.md) also tests recovery of a
pre-existing native service-worker registration, with working Chromium sync and
background-fetch controls. Periodic sync remains uncalibrated.
The [deferred-fetch probe](fetch-later.md) confirms a native page-close upload
and tests the prepared runtime against that route in Chromium.

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
The [generation comparison](confinement/generation-reads.md#partial-comparison-with-real-indexeddb-outcomes)
checks 24 observed read/replacement pairs against possible modeled completions;
it does not observe the transaction's internal timing.
The [model-to-implementation mapping](implementation-mapping.md) identifies which
code paths correspond to model actions and where that correspondence is missing.
The [Web IDL report](idl-surface-report.md) joins selected standards to observed
browser interface names and highlights members that still need review.

These checks do not compose into a proof that the implementation confines every
browser effect. The abstract models assume that important browser and runtime
mechanisms work as specified; the browser tests cover particular routes, versions
and schedules. A new browser API or an untested use of browser-owned state can
expose an unmodeled channel. The [work plan](PLAN.md) tracks the remaining
correspondence, browser coverage and simplification work.
