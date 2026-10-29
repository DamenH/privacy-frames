# Trusted runtime isolation progress

The corrected architecture is deployed. Application JavaScript stays in the native
browser context; document compilation, fragment preparation and markup validation
run in a private iframe created before application execution. Native enforcement
hooks retain their protections beside the application.

See the [completion audit](trusted-runtime-completion.md) for release pins,
verification, performance and limits. The [plan](realm-runtime-plan.md) records the
scope correction, and the [size audit](trusted-runtime-size.md) counts both local
code and the embedded private bundle.

The recovery tag `pre-realm-runtime-2026-10-29` still identifies the previous main
at `1a78033b48a64b72cd21b4467b96e7c7eba6a2f1`. Application-in-realm experiments
remain under `test/realm-research`, outside production.
