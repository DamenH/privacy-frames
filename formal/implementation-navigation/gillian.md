# JavaScript symbolic analysis of the navigation handler

Run `node formal/implementation-navigation/gillian-check.ts` with Docker and the
project's npm dependencies installed. The runner uses a digest-pinned official
Gillian image with networking disabled during analysis. Generated fixtures and
full logs stay in `.tools/gillian-navigation/`; the checked-in receipt records
their hashes and result summaries.

The runner extracts the actual `navigate` callback from
`src/runtime/enforcement/navigation.ts`. TypeScript converts that callback to
ES5 for Gillian-JS. We do not translate its condition to our Lean expression
language for this experiment. Gillian analyzes the resulting JavaScript,
including function calls, Boolean coercion, short-circuit evaluation and caught
exceptions.

The surrounding fixture supplies contracts for the captured native operations.
Successful predicates return primitive booleans; the destination, same-document
and URL getters and route predicate can throw. Six independent symbolic booleans
represent these outcomes. The fixture asserts the resulting cancellation,
exception and predicate-read counts, along with native-call receivers and
arguments. In particular, a successful cross-document
lookup must cancel without reading the URL or calling the route predicate.

The controls are a true and a false symbolic assertion, the actual callback, a
callback with cancellation removed, and a callback with `||` weakened to `&&`.
The runner requires successful analysis for the actual callback and positive
control, and assertion failures for the other cases. Compilation errors and
tool crashes do not count as successful negative controls.

This uses Gillian's `wpst` whole-program symbolic testing mode, with its default
unrolling limit of 100. The fixture and callback have no explicit loops or
recursion. The result remains an analysis under Gillian's JavaScript and built-in
models, rather than a kernel-checked proof certificate. The TypeScript parser,
callback extraction, ES5 compilation, Gillian and its solver are trusted.
The fixture does not establish native binding integrity, setup order, route
predicate implementation, browser event delivery or the effect of cancellation.
Those obligations remain in the [navigation argument](README.md) and
[browser contract](browser-contract.md).

The image is pinned by digest in the runner. Its `gillian-js` binary hashes to
`b1a00b243bd9ab6c67ea966719a9874e52c6e5615aeeb7232da1f43e58921737`.
The inspected upstream checkout was
`469aa5c134ba7790c40669bd4bc50483aff36d7b`; the image does not identify its source
revision, so we do not claim that it was built from that checkout.
Upstream documents [Gillian-JS and its ES5 scope](https://github.com/GillianPlatform/Gillian)
and publishes the image through its
[container workflow](https://github.com/GillianPlatform/Gillian/blob/469aa5c134ba7790c40669bd4bc50483aff36d7b/.github/workflows/ci.yml).
