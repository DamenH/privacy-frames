# Contract for one root-document navigation path

The selected path is a script-created ordinary link, targeting a new document
in its own top-level window. This is the path exercised by
`formal/navigation-preload-fault.ts`. The result is conditional on browser
behavior; it is not a proof of Chromium or Firefox source.

The [HTML navigate-event algorithm](https://html.spec.whatwg.org/multipage/nav-history-apis.html#fire-a-push/replace/reload-navigate-event)
sets the destination and delegates to the inner firing algorithm. Non-traversal
events are cancelable there. The [navigation algorithm](https://html.spec.whatwg.org/multipage/browsing-the-web.html#navigate)
uses the event's result to decide whether to proceed. The
[DOM cancellation rules](https://dom.spec.whatwg.org/#dom-event-preventdefault)
make prevention effective only for a cancelable event outside a passive listener.
These living specifications were read on 30 October 2026; this document is an
inspected argument, not a machine-checked translation of their algorithms.

| Obligation                                                                           | Current connection                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Genuine event reaches this window's listener before its navigation fetch             | Assumed browser ordering; selected event and receiver test supports it.                                                                                                                                          |
| Captured native destination getters return a valid destination and primitive Boolean | Source capture expressions are checked. Selected genuine events expose the expected values without throwing.                                                                                                     |
| Listener runs synchronously, with effective cancellation                             | Source checker rejects an async callback, checks capture registration and exact action. Browser fixture observes cancelable events and prevention in the normal case.                                            |
| Cross-document condition requests cancellation after successful native getters       | Source-derived theorem covers the actual kernel condition and getter exceptions; it has no route predicate.                                                                                                      |
| Cancellation stops the request and its preload                                       | Browser contract supported by zero marker requests in normal cases and actual marker delivery when the action is removed in test bundles.                                                                        |
| Listener and captured natives are established before application execution           | Source/build prefix checks put the kernel before heavy module initialization; later source-order checks put preparation before rendering. Native/compiler-helper semantics and shell parsing remain assumptions. |

The browser fixture adds a later observer to record trusted status, cancelability,
default prevention, same-document status and navigation type. It observes a
cancelable cross-document push in each native, normal and altered case. The
normal case is prevented; the other two are not. The source-derived theorem
establishes the cancellation request under its native-getter assumptions. The
fixture supplies empirical evidence that cancellation has the intended effect
for those cases with native preload deliberately enabled.

This argument does not extend automatically to traversals, downloads, other
windows changing this window's location, browser UI, disabled Navigation API
events or other context types. The [HTML introduction](https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-navigate-event)
explicitly describes event-delivery and traversal exceptions. Those routes need
separate authority and enforcement arguments. An exception from a native getter
before cancellation is also outside the proved safety case.

The trusted components of the current connection are the TypeScript parser,
restricted extractor/translation, Lean kernel and its checked semantics, native
binding interpretation, uncontaminated initialization and the browser contract.
The current work does not eliminate those assumptions. It makes them explicit
so that setup verification and a stronger translation argument can address them.

The [installed-app test](installed.md) exercises the same-window link path after
ordinary installation and root startup. It verifies the actual guard response
bytes and service-worker delivery of the shell and installed content. Trusted
test setup enables native preload after the bridge has disabled it; cancellation
removal then produces a seeded receiver request in both browsers. This adds
installed-path evidence under that explicit preload condition without extending
the argument to other navigation routes.

The initialization probe additionally attempts the selected link operation in the
heavy root module body. Native and altered-kernel controls reach an independent
receiver; the normal kernel prevents the event and produces no receiver request
during the observation interval. This tests the earlier startup boundary without
running the installed application or proving every module's behavior.
