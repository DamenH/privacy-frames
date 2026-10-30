# Preparation helper obligations

The selected root path begins in a trusted shell before publisher markup is
rendered. The navigation listener now installs before intrinsic preparation,
policy-tool construction, the private parser and all application context
factories. The early installer captures native operations directly; its returned
finalizer receives policy tools after native popup capture. The source-order
checker rejects moving either initialization routine ahead of cancellation.
It permits only the `sourceURL = applicationURL` metadata binding before the
early call in the realm function; an added call there is rejected.

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
remaining hooks. `prepareWindowRealm` calls that finalizer with the policy tools
and popup function after the popup factory captures native window.open. The
early stage uses captured `Reflect.apply` and the imported `ownDescriptor`,
without constructing the broader tool object. The checker enforces both native
capture expressions, the helper import and the two stages' argument boundary.

Before listener installation, the early stage constructs metadata records,
reads native descriptors and location state, and invokes captured URL operations.
`ownDescriptor` uses captured `Object.getOwnPropertyDescriptor` and detaches the
result through `internalRecord`; `internalRecord` uses captured
`Object.setPrototypeOf`. These operations require genuine native objects and
plain host metadata in an uncontaminated realm. Module initialization also
precedes entry to the realm function. The source checks do not prove those
native-operation contracts or all import-time effects.

The built root guard still initializes Acorn and the module parser's extensions
before reaching its entry function. For example,
`src/runtime/modules.ts` constructs `Parser.extend(importPhases())` at module
scope. Moving a call earlier inside `prepareWindowRealm` does not move it ahead
of this work.

A local build-only experiment put an import-free navigation guard before a
dynamic import of the actual root guard. Esbuild 0.28.2 produced one script,
with the early guard call before
`Promise.resolve().then(() => (init_guard(), guard_exports))`; code splitting
was disabled. This demonstrates a possible initialization boundary, not a
working replacement. The root guard currently reads `document.currentScript`
during module initialization, so its script reference would need to be captured
before deferral and passed explicitly. The child guard's configuration and
publication protocol would also need verification under that ordering.

Helpers after listener installation still need transitive summaries covering
constructor callbacks, returned closures, delayed initialization and the point
publisher-controlled bytes first become executable. The intrinsic and policy-tool
routines are now in this later group; their bodies no longer precede navigation
cancellation.
