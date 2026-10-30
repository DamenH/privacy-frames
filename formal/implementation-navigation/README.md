# Implementation-connected navigation verification

The selected property is that the runtime requests cancellation of a
cross-document navigation before the heavy runtime modules initialize. The
browser must deliver the event before initiating the request and honor its
cancellation. This directory separates the implementation checks from that
[browser contract](browser-contract.md).

The import-free `src/runtime/enforcement/document-exit.ts` captures native
navigation getters, event registration and cancellation. Its private flag makes
successful installation idempotent. The root and child-document entries install
this guard synchronously, capture their script element, then defer their heavy
modules through a bundled dynamic import. The build produces one script for each
entry; deferral introduces no additional module download.

## Source and build checks

Run `node formal/implementation-navigation/check.ts` with the pinned Lean
installation from `formal/lean/README.md`. The checker recognizes the entire
small kernel, including its native captures, registration, callback and flag
assignment. Unknown statements are rejected. It generates Lean obligations from
the actual callback condition. Lean checks cancellation for a successful
cross-document lookup, normal return for a same-document lookup, and propagation
of either getter exception. The receipt includes the generated proof and axiom
report. Wrong native calls, registration, installation flag and condition are
negative controls. Generator and async installers are rejected because installation
must complete synchronously when called.

This is restricted source correspondence under a trusted TypeScript parser and
extractor. It assumes the recognized native bindings have their browser meaning.
A requested cancellation is distinct from an externally suppressed request.

After `HOST_ROLE=runtime npm run build`, run
`node formal/implementation-navigation/bootstrap-check.ts`. It compares rebuilt
entry bytes with the runtime artifacts and checks the emitted initialization
prefix. Only the small kernel's module initializer may execute before the entry
calls its installer; heavy module initializers remain deferred. Compiler helper
shapes are checked, with compiler and native-operation semantics still trusted.
Eager heavy initialization and an unknown entry prefix are rejected.

`node formal/implementation-navigation/setup-check.ts` checks the subsequent
root startup and realm preparation order. Application rendering remains after
realm preparation. The later navigation-policy finalizer receives policy tools
and the captured popup factory. These checks recognize specified source shapes;
they do not interpret arbitrary helpers or prove compiler correctness.

The [helper review](helper-review.md) and the trusted-source/build-source checks
trace the private parser's executable source back to the trusted build. They
retain explicit obligations about the behavior of that parser and its callers.

## Symbolic analysis and browser evidence

The [Gillian analysis](gillian.md) exercises the actual callback and whole small
kernel under explicit native contracts. It includes registration failure,
repeated installation and getter exceptions. Its symbolic-testing mode does not
produce a kernel-checked proof certificate.

`node formal/implementation-navigation/initialization-run.ts` inserts a test
probe into the heavy root module body. A native link reaches an independent
receiver. The normal entry cancels the same operation; removing only the kernel's
cancellation action lets the request reach the receiver again. The probe stops
before root startup, so this checks the module-initialization boundary rather
than ordinary installed-app execution. Source and bundle hashes are saved in
`initialization-result.json`.

The [installed-app test](installed.md) exercises ordinary installation, service
worker delivery and root startup before attempting the selected navigation.
It checks actual guard bytes and compares normal cancellation with an altered
test bundle under deliberately enabled navigation preload.

These arguments cover the selected navigation path. They do not establish that
all browser communication mechanisms have been enumerated or that the complete
runtime enforces confinement. Traversals, other windows, downloads and other
context types require their own coverage and enforcement arguments.

Earlier compatibility and deployment receipts in this directory identify their
own source revisions and artifact hashes. They remain historical evidence;
they do not verify this changed bootstrap architecture.

The [early-kernel compatibility receipt](compatibility-early-kernel.json) records
all eight applications passing their selected native and confined tasks in
Chromium and Firefox. The build artifacts remained stable throughout the run.
Source and artifact hashes identify the tested uncommitted inputs.
