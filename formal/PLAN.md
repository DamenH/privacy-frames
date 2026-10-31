# Confinement verification work

The current eight-stage implementation plan is in
[runtime-verification/README.md](runtime-verification/README.md). The work below
records the earlier modeling and evidence programme on which it builds.

The goal is an explicit security argument for the deployed host and opportunities
to simplify restrictions that do not support the agreed network property.

1. Specify the threat model, trusted browser assumptions, local and remote effects,
   installation boundary, and storage sharing across installations.
2. Model the lifecycle and all five invariants. Include child/worker ownership,
   admission, installation generations, controller replacement, revocation, message authority and durable
   state. Add fault-injection configurations with observable counterexamples.
3. Map model actions to implementation entry points and browser obligations.
   Verify small pure authorization/admission decisions against their specifications
   where practical, and check instrumented implementation traces against the model.
4. Inventory context creation, transports, navigation, browser agents and authority
   acquisition. Compare specifications, runtime feature enumeration and Web Platform
   Tests; mark every discovered capability as enforced, excluded or unverified.
5. Test actual browser behavior with unrestricted positive controls and independent
   HTTP, TCP, DNS and UDP receivers. Translate relevant model counterexamples into
   tests. Expand browser/version coverage without weakening existing checks.
6. Remove modeled restrictions one at a time, check for counterexamples, then audit
   actual consumers and test any justified implementation simplification against
   the security suite and existing application corpus.
7. Record model bounds, counterexamples, proof and test results, correspondence
   gaps, browser assumptions, retained restrictions and measured changes. Passing
   finite checks must not be presented as full implementation verification.

The models and evidence under `formal/` are work in progress. Their documented
bounds and correspondence gaps remain part of the work described above.
