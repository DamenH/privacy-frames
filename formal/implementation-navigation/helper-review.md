# Preparation helper obligations

The selected root path begins in a trusted shell before publisher markup is
rendered. The navigation listener now installs immediately after intrinsic and
policy-tool preparation, before the private parser and all application context
factories. The source-order checker rejects moving these helpers before it.
The listener's inputs are initial root metadata and native event operations;
no publisher markup is required to install it.

The private parser still uses private-frame eval in
`src/runtime/trusted/context.ts`. The helper creates an empty iframe, reads its
eval, applies it to the `source` parameter and removes the frame. Its caller,
`src/runtime/trusted/client.ts`, supplies a default import from
`trusted:policy-source`; applicationURL is not that evaluation argument.
Application markup is subsequently passed to returned policy methods as data.

Run `node formal/implementation-navigation/trusted-source-check.ts`. It checks
this selected def-use chain in the actual TypeScript: the imported binding has
only its import and call references, the parameter has only its declaration and
evaluation reference, and the known eval call has exactly that argument and
receiver. Changes to the import, caller argument or evaluation argument are
rejected. The receipt pins both source files and the checker.

This establishes a restricted source-origin property. The separate build-source
check confirms the actual virtual import's bytes match a reconstructed trusted
entry bundle. Compiler correctness remains assumed. These checks do not establish
that the imported program never evaluates publisher text, that arbitrary helpers have no execution
effects, or that frame construction obeys the expected browser behavior. Those
remain proof obligations. The parser, extractor and uncontaminated initial native
bindings are trusted for the source check.

Navigation preparation now has two stages. `prepareNavigationPolicy` captures
navigation state and installs the listener, then returns a finalizer for the
remaining hooks. `prepareWindowRealm` calls that finalizer after the popup
factory captures native window.open. This preserves that native capture while
moving cancellation ahead of private parser evaluation. The checker enforces
the order relative to the parser, context factories and popup capture.

The intrinsic and policy-tool preparation before the listener still need effect
summaries. Helpers after listener installation also need transitive summaries covering
constructor callbacks, returned closures, delayed initialization and the exact
point publisher-controlled bytes first become executable. A list of top-level
calls or passing browser examples does not prove these summaries.
