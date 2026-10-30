# Preparation helper obligations

The selected root path begins in a trusted shell before publisher markup is
rendered. That is a browser/controller assumption, not a consequence of the
navigation condition theorem. `prepareWindowRealm` constructs the private parser
context, policy tools, resource aliases, publisher facade and context factories
before installing navigation policy. Its direct order is source-checked.

The known execution operation during that preparation is private-frame eval in
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

This establishes a restricted source-origin property. It does not establish
that the bundler implements the virtual import correctly, that the imported
program never evaluates publisher text, that arbitrary helpers have no execution
effects, or that frame construction obeys the expected browser behavior. Those
remain proof obligations. The parser, extractor and uncontaminated initial native
bindings are trusted for the source check.

Moving the entire navigation installer earlier is not a mechanical simplification.
It replaces window.open, while createPopupFactory captures window.open during its
construction. Reordering these operations would change the capture. Isolating an
earlier cancellation kernel would require an explicit design and compatibility
checks; this experiment has not changed that production order.

The other preparation helpers still need transitive effect summaries covering
constructor callbacks, returned closures, delayed initialization and the exact
point publisher-controlled bytes first become executable. A list of top-level
calls or passing browser examples does not prove these summaries.
