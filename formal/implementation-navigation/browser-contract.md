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

| Obligation | Current connection |
| --- | --- |
| Genuine event reaches this window's listener before its navigation fetch | Assumed browser ordering; selected event and receiver test supports it. |
| Captured native destination getters return a valid destination and primitive Boolean | Source capture expressions are checked. Selected genuine events expose the expected values without throwing. |
| Listener runs synchronously, with effective cancellation | Source checker rejects an async callback, checks capture registration and exact action. Browser fixture observes cancelable events and prevention in the normal case. |
| Cross-document condition requests cancellation without evaluating the route predicate | Source-derived short-circuit theorem covers arbitrary route return or exception. |
| Cancellation stops the request and its preload | Browser contract supported by zero marker requests in normal cases and actual marker delivery when the action is removed in test bundles. |
| Listener and captured natives are established before application execution | Source-order checker puts listener installation before private parser evaluation and context factories, and before realm return. Intrinsic/tool preparation, imports and browser shell parsing remain assumed safe before the listener. |

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
