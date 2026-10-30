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

The root and child entries now statically import only the small document-exit
kernel. They install cancellation before deferring their heavy module graphs.
Each captures its script element before deferral and passes that reference to
the exported startup function. The child keeps its configuration lookup and
parent publication protocol in the later module.

The bootstrap checker checks source entry shapes and the actual bundled prefix.
Before cancellation, emitted code contains compiler aliases, deferred factories,
export getters and the kernel initializer. The checker rejects an eager heavy
initializer or an unknown prefix. Compiler-helper and native-operation semantics
remain trusted. The initialization receiver test separately confirms that the
selected navigation is cancelled by the time the heavy root module body runs.

Later navigation preparation installs routing and history restrictions and returns
a finalizer. Realm preparation calls it after the popup factory captures native
window.open. The early kernel's private installation flag makes the later call
idempotent. The setup checker still checks this finalizer's argument boundary.

The kernel performs descriptor lookup, native listener registration and a private
flag assignment before deferral. These require genuine native objects in an
uncontaminated shell. Its callback uses native getters and cancellation directly;
it does not call the private parser, policy tools or route predicate.

Helpers after installation still need summaries covering callbacks, returned
closures and the point publisher-controlled bytes first become executable. The
kernel blocks the selected navigation during those helpers; their other effects
and the full confinement policy remain separate obligations.
