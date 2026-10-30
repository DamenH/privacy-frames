# Local hardening audit

The application still runs native JavaScript beside local browser hooks. Moving
HTML parsing and document compilation into the private trusted context removed
those library consumers from the application realm. It did not move document
lifecycle records, resource aliases, storage wrappers or publisher communication.
This audit follows those remaining consumers; it does not establish completeness
for every JavaScript or browser operation.

## Consumers that remain local

| Protection                                                         | Actual trusted consumer                                                                                                                                               | Why the private parser does not replace it                                                                                                                                                                           |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `internalRecord` and `ownDescriptor`                               | `enforcement/native.ts` builds method/accessor descriptors and denial records; `document-factory.ts` stores pending documents; `trusted/client.ts` reads reply fields | Descriptor conversion and optional-field reads happen locally, including after application callbacks. These records must not inherit application fields.                                                             |
| `internalArray`                                                    | `document-factory.ts` queues startup actions and traverses native children; worker/popup factories retain native references and transfer lists                        | The controller/parser does not own these native DOM references or synchronous insertion operations. Private array methods and iteration avoid application hooks receiving those records.                             |
| `internalMap` and `internalSet`                                    | `resource-aliases.ts` owns URL mappings and installed destinations; document factories own records; publisher client owns registration views                          | These collections remain in callback closures. Their private prototypes preserve captured operations and exclude application-added protocols.                                                                        |
| Public collection method protection                                | `internalMap(entries)` and `internalSet(values)` construct native collections before changing their prototypes                                                        | Native construction consumes entries through the public prototype's insertion method. A later private prototype does not protect that earlier step. Removing this dependency requires changing initialization first. |
| `internalData`                                                     | `trusted/client.ts` parses private-context replies; `guard.ts` reads bootstrap metadata; IndexedDB listing and protocol readers normalize data                        | JSON and structured cloning create new records in the receiving application realm. The private producer does not supply private local prototypes.                                                                    |
| Captured `strings` operations                                      | `resource-aliases.ts` resolves addresses; navigation/resource-element hooks classify attributes; storage wrappers check namespace prefixes                            | These operations occur during live API calls. String prototype polyfills remain allowed, so local policy must use captured operations.                                                                               |
| Protected native methods and prototype ancestry in `intrinsics.ts` | Local factories use captured WeakMaps, descriptor operations and promises; storage wrappers process native results                                                    | Capturing a constructor or method does not protect every subsequent prototype lookup or implicit engine operation. Ancestor replacement would also change inherited operations.                                      |
| Reserved `then`, `toJSON` and symbol protocols                     | Async storage wrappers await browser-produced arrays; local private records enter JSON messages and promise chains                                                    | Some native result arrays exist before the wrapper can detach their prototype. Record normalization cannot run before the engine resolves that native promise.                                                       |
| Frozen Error families and stack-hook reservations                  | Policy tools, trusted-client error conversion and context wrappers construct local errors                                                                             | Trusted callbacks still execute locally. The private parser's serialized errors remove foreign error objects from that one boundary, not from all local error creation.                                              |
| `sealRuntimeBindings`                                              | Window, worker and worklet bootstraps seal globals after installing policies                                                                                          | Local code still reads bindings such as Array, Object, JSON and browser constructors. Each remaining lookup needs capture or removal before its binding protection can be deleted.                                   |

`shadowableMethod` also serves compatibility: it permits ordinary instance
properties while keeping shared operations fixed. The collection and general
intrinsic profiles deliberately differ on identical owner assignments. Native
constructor metadata, diagnostic hooks and polyfill exceptions are part of that
profile, not independent security mechanisms that can simply be deleted.

The getter's `originalValue` field has no ordinary production reader outside
`intrinsics.ts`, but it is still a traversal edge: recursive hardening visits the
original collection function through that field after installing an accessor.
Deleting it without another traversal would skip those reachable function
objects. Its public metadata could be replaced by an explicit visit of captured
operations, but that would be a separate refactor rather than a clear code saving.

## Small removals made

- Removed `ownDescriptors`. Production code did not import it; its consumers were
  tests of the unused export. Individual descriptor protection remains tested.
- Removed the private copy of the entire Math namespace. Its sole production
  consumer was the document clone traversal's minimum of two array lengths. The
  loop now checks both numeric bounds directly.
- Removed WebAssembly, Intl and Atomics from `ambientNames`; `languageGlobals`
  already contributes all three to the same sealed-name set.

Across `primordials.ts`, `bindings.ts` and `document-factory.ts`, these changes
remove 19 source lines and 615 bytes. The unused descriptor export may already
have been eliminated by bundling; this source reduction is not a measured bundle
reduction.

The document-factory fixture now clones a container with a nested prepared
iframe while application code replaces `Math.min`. It verifies that the nested
source still reaches trusted registration. That exercise and the existing
factory controls pass in Chromium and Firefox. Eight primordial unit tests and
the intrinsic fixture pass; the latter retains its 3,934/3,938 browser checks.

## Larger candidates and prerequisites

**Worklet-specific hardening is the clearest profile to investigate next.** Its
metadata validation finishes before publisher code. Its exported dynamic-import
rejection uses captured String, Promise.reject, TypeError and Reflect.apply.
However, `installEffectPolicy` also installs local denial callbacks, and the
native processor/paint interfaces remain available. Removing the full global
hardening pass requires enumerating those callbacks and supported native globals,
then checking real processor output, module refusal and context ownership. The
current worklet fixture explicitly tests sealed bindings and protected
prototypes; changing those assertions alone would not verify confinement. No
worklet protections were removed in this pass.

**Further pure decisions can move privately, but the small navigation predicates
are unlikely to justify another bridge call.** `isNavigationTarget` and
`isUnsafeTargetMutation` classify strings, while their local callers still own
attribute coercion, synchronous native setters and SVG receiver registration.
The parser already uses the shared predicates privately. Moving their remaining
few string operations would leave those native hooks and the other string-helper
consumers intact. A reduction claim needs an end-to-end comparison including the
new request/reply code and synchronous call cost.

**Collection protection could be reduced only after construction changes.**
Creating an empty native collection, attaching its private prototype, and filling
it through captured operations would remove the constructor dependency described
above. Native iterator objects and any remaining public-prototype collections
would still need a consumer audit. This is a prerequisite candidate, not approval
to remove the collection profile now.

**The global binding pass needs a per-binding audit before narrowing.** Examples
of remaining lookups include Array.isArray in document message handling,
Object.assign in publisher registration facades and Object.entries in accessor
installation. Some run only during bootstrap, while others run after application
execution. Capturing the latter explicitly could permit selected binding
restrictions to disappear. It would not remove native browser effect policies or
context authorization.

## Native markup and the DOMPurify comparison

The private parser does not currently replace `native-markup.ts`. That validator
reads the real insertion context, distinguishes HTML from XML documents, carries
in-scope XML namespace declarations into a viewless construction document, and
inspects the browser's resulting nodes through captured getters. The current
private markup request carries text and a document flag, not that context.

The separate DOMPurify comparison reports changes to accepted Blob image/audio
and SVG foreign content or animation. A sanitizer that removes hostile markup
while also changing these accepted cases has not replaced the existing policy.
Keeping both implementations would add a dependency without removing the local
validator or its captured-operation consumers. The current result supports a
development comparison, not production deduplication.

A later move could put native validation in the private browser context after
adding an explicit serialized insertion-context description and equivalent
HTML/XML controls. Local code would still need to read that context safely and
mediate the final insertion. Moving a few string predicates while retaining the
native traversal does not achieve that boundary change.
