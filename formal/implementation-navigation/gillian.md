# Symbolic analysis of the navigation kernel

Run `node formal/implementation-navigation/gillian-check.ts` with Docker and the
project's npm dependencies installed. The runner uses a digest-pinned official
Gillian image with networking disabled during analysis. Generated fixtures and
full logs stay in `.tools/gillian-navigation/`; `gillian-result.json` records
hashes and result summaries.

The runner extracts the actual callback from
`src/runtime/enforcement/document-exit.ts` and separately analyzes the whole
kernel. TypeScript converts both fixtures to ES5. Gillian analyzes their
JavaScript execution without using our Lean expression translation.

The callback fixture has three symbolic booleans: whether the destination getter
throws, whether the same-document getter throws, and the successful Boolean
result. It checks native-call receivers and arguments, cancellation and exception
behavior. The whole-kernel fixture adds symbolic registration failure. It calls
the installer twice, checks that successful registration happens exactly once,
and invokes the registered handler. A failed registration must leave installation
retryable.

The fixture supplies explicit native contracts for descriptor lookup, registration,
destination access and cancellation. Descriptor lookup accepts only the expected
prototype/key pairs and returns the designated getter. This models the browser
operation; it does not verify its implementation. The pinned image's default
runtime did not expose the `Object.defineProperty` operation needed by an earlier
fixture, so descriptor contracts are supplied directly.

Controls include true and false symbolic assertions, missing cancellation,
a reversed condition and a missing installation flag. The runner requires
assertion failures for the defective fixtures. Compilation errors and tool
crashes do not count as successful negative controls.

This uses `wpst` whole-program symbolic testing with its default unrolling limit
of 100. It is not a proof certificate. TypeScript parsing, extraction, ES5
compilation, Gillian, its solver and the supplied native contracts remain trusted.
Browser event delivery, module initialization order and external effects are
separate obligations in the [navigation argument](README.md).

The image is pinned by digest in the runner. Its `gillian-js` binary hashes to
`b1a00b243bd9ab6c67ea966719a9874e52c6e5615aeeb7232da1f43e58921737`.
The inspected upstream checkout was
`469aa5c134ba7790c40669bd4bc50483aff36d7b`; the image does not identify its source
revision, so we do not claim that it was built from that checkout.
Upstream documents [Gillian-JS and its ES5 scope](https://github.com/GillianPlatform/Gillian)
and publishes the image through its
[container workflow](https://github.com/GillianPlatform/Gillian/blob/469aa5c134ba7790c40669bd4bc50483aff36d7b/.github/workflows/ci.yml).
