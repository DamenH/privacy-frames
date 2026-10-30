# Source-derived navigation decision

Run `node formal/implementation-navigation/check.ts` with npm dependencies and
the pinned Lean 4.35.0 installation described in `formal/lean/README.md`.
The checker reads the actual TypeScript navigation handler. It recognizes the
listener registration, its capture flag, destination lookup, conditional and
cancellation action. It accepts only a small Boolean-expression language over
the two recognized predicates. Extra handler statements and unknown expressions
are rejected. It generates the Lean expression from that source condition and
checks the theorem for every pair of Boolean inputs with `--trust=0`.

The result establishes that the extracted condition cancels exactly when the
destination is not both same-document and an allowed route. The proof is derived
from the implementation expression, rather than a separately maintained copy.
Removing the cancellation action fails extraction; weakening OR to AND fails
the proof. `result.json` saves source/checker hashes, the generated proof and its
axiom report. No production source changes are required by this experiment.

This is a restricted source correspondence check, not a formal JavaScript
semantics. The TypeScript parser, extractor and expression translation are trusted.
It assumes the two predicates produce primitive Booleans without exceptions and
that the captured functions resolve to their intended native operations. It does
not establish that the handler is installed before application code, that it
executes on every relevant navigation, or that `preventDefault` prevents every
external effect. These are separate implementation and browser obligations.

The existing `formal/navigation-preload-fault.ts` connects the same cancellation
action to an independently observed browser effect in selected Chromium and
Firefox executions. It removes only that action in a test bundle and observes a
local marker request with deliberately enabled preload. This empirical evidence
supports the selected browser contract; it is not a proof over all executions.

Remaining work for the complete path is to check the captured native bindings,
setup ordering and callback reachability, formalize the short-circuit and
exception behavior at the predicate boundary, and specify the browser rule that
relates cancellation to navigation/preload delivery. A stronger translation
argument must also replace trust in this small extractor if the intended result
requires a machine-checked JavaScript-to-proof connection.
