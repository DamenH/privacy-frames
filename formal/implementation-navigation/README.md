# Source-derived navigation decision

Run `node formal/implementation-navigation/check.ts` with npm dependencies and
the pinned Lean 4.35.0 installation described in `formal/lean/README.md`.
The checker reads the actual TypeScript navigation handler. It recognizes the
listener registration, its capture flag, destination lookup, conditional and
cancellation action. It accepts only a small Boolean-expression language over
the two recognized predicates. Extra handler statements and unknown expressions
are rejected. It generates the Lean expression from that source condition and
checks the theorem for every pair of Boolean inputs with `--trust=0`.
It also checks the six constant capture expressions for the listener, navigation
object, cancellation method and destination getters. A changed native action
or event name fails extraction. Token normalization preserves string contents.

The result establishes that the extracted condition cancels exactly when the
destination is not both same-document and an allowed route. The proof is derived
from the implementation expression, rather than a separately maintained copy.
Removing the cancellation action fails extraction; weakening OR to AND fails
the proof. `result.json` saves source/checker hashes, the generated proof and its
axiom report. The production initialization was subsequently split into the two
stages described below to reduce the pre-cancellation helper assumptions.

`Expression.lean` adds restricted left-to-right, short-circuit semantics with
explicit abrupt completion. The checker generates a second expression tree
from the same TypeScript condition. The kernel checks that a cross-document
event requests cancellation regardless of whether the unevaluated route
predicate would return or throw. It also checks the actual failure behavior:
a throwing native same-document getter propagates an exception, as does a
throwing route predicate for a same-document event. Cancellation here means
the recognized call is requested, not that the browser has performed it.
An eager-evaluation mutation preserves the Boolean result on successful inputs
but invalidates the exception-sensitive theorem and is rejected.

This is a restricted source correspondence check, not a formal JavaScript
semantics. The TypeScript parser, extractor and expression translation are trusted.
The Boolean theorem assumes primitive-Boolean inputs without exceptions. The
second theorem accounts for predicate exceptions, but both still assume
that the checked capture expressions resolve to their intended native operations
in an uncontaminated setup environment. It does
not establish that the handler is installed before application code, that it
executes on every relevant navigation, or that `preventDefault` prevents every
external effect. These are separate implementation and browser obligations.

The existing `formal/navigation-preload-fault.ts` connects the same cancellation
action to an independently observed browser effect in selected Chromium and
Firefox executions. It removes only that action in a test bundle and observes a
local marker request with deliberately enabled preload. This empirical evidence
supports the selected browser contract; it is not a proof over all executions.

Remaining work for the complete path is to check the captured native bindings,
setup ordering and callback reachability, establish valid native getter behavior
for genuine events, and specify the browser rule that
relates cancellation to navigation/preload delivery. A stronger translation
argument must also replace trust in this small extractor if the intended result
requires a machine-checked JavaScript-to-proof connection.

The [browser contract](browser-contract.md) connects the selected root link path
to the relevant HTML and DOM algorithms and the receiver fixture's genuine-event
observations. It records which premises are source-checked, empirically tested,
or still assumed, and identifies navigation routes outside this argument.

`node formal/implementation-navigation/setup-check.ts` checks direct source order
in the actual root guard and realm preparation function. It requires preparation
before the unique deferred `start` call, locates the root rendering call inside
that start closure, and requires navigation installation before the realm's only
direct return. Both installers must remain synchronous. Early-start and early-return
mutations are rejected. `setup-result.json` pins the inspected sources and checker.
These checks do not prove arbitrary helper semantics, aliasing, import side effects,
all control flow, or browser parser ordering. In particular, trusted preparation
helpers must not execute publisher code. The result covers the root entry path;
child document startup has separate preparation and publication obligations.

The [helper review](helper-review.md) records the private parser's known execution
operation and its source-origin check. It also explains why moving the complete
navigation installer earlier would change a native popup capture. This check
narrows one helper assumption; it does not prove every preparation helper safe.

`node formal/implementation-navigation/build-source-check.ts` builds a fixture
through the real virtual-import plugin and decodes its generated data export
without evaluating it. The exported string must exactly match an independently
built trusted entry and wrapper. The receipt records every trusted-entry input
hash, the plugin, lockfile, compiler version and output hashes. Executable export
initialization, cyclic aliases and a substituted source are negative controls.
This checks provenance and byte correspondence, not esbuild correctness or the
behavior of the resulting program. TypeScript's parsing of literal values is
also trusted. Source/build/dependency changes trigger the proof workflow.

The production initialization is now split: `prepareNavigationPolicy` installs
cancellation early and returns a finalizer for the remaining navigation hooks.
The realm calls the finalizer after native popup capture. The source-order check
requires cancellation before the private parser and all context factories, and
rejects moving parser evaluation earlier. This reduces the helper behavior that
must be trusted before cancellation; intrinsic preparation and policy-tool
construction remain before it. The whole sandbox still requires all effects
and publication policies to finish before application execution.
The two-stage source check also requires a synchronous returned finalizer and
its exact connection to the popup factory. An async-finalizer mutation and a
missing popup argument are rejected. This checks the recognized connection;
it does not prove arbitrary finalizer effects or aliased control flow.

The [compatibility receipt](compatibility-early-cancellation.json) records all
eight applications passing selected native and confined tasks in Chromium and
Firefox after the initialization change. Its checkout revision predates the
source commit because the change was being tested uncommitted; source and build
hashes identify the tested inputs, and the build remained stable throughout.
This is compatibility evidence, separate from receiver tests and proofs.

The two-stage initialization was deployed from host revision
`772480e600d2d60e3b691caba0c59c790e9e5612`. The live service worker and four
checked guards matched the locally tested build. A fresh Chromium installation
passed the identity and sampled reporting-header checks. These live checks do
not replace the local fault controls or prove every browser path.

The [Gillian-JS experiment](gillian.md) analyzes the extracted callback as ES5
JavaScript under explicit native-operation contracts. It checks cancellation,
exceptions, evaluation order and call receivers without using the restricted
Lean expression translation. The actual callback passes; removing cancellation
or weakening the condition causes assertion failures. This is whole-program
symbolic testing, not a proof certificate or a complete browser model.
