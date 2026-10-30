# Restriction review

The no-remote-effect policy does not require every current compatibility
restriction. A candidate must still preserve the mediation on which that policy
depends.

The former `Element.prototype.attachInternals` denial was removed because that
method is owned by `HTMLElement.prototype` in the tested Chromium and Firefox;
the policy helper silently ignored the nonexistent property. Removing the
no-op does not change either browser's behavior or establish that every use of
element internals is safe.

`NamedNodeMap.removeNamedItem` and `removeNamedItemNS` are currently refused in
[dom.ts](../src/runtime/enforcement/dom.ts). The native lookup methods can find
the attribute before removing it; its native `ownerElement` identifies the
element. A guarded implementation could then use the existing
`removeAttributeNode` path, rather than directly removing an attribute. That
path matters for frames: removing a source may initiate navigation and needs
the document factory's handling.
This candidate has not yet been implemented or tested.
The current recommendation is to retain the restriction: the adapter would add
code, and the recorded compatibility corpus does not identify this operation as
a blocker. Directly enabling native removal would bypass the existing JavaScript
wrapper for managed frame sources. A changed physical source could affect the
frame lifecycle; no escape has been demonstrated from that route.

The implementation would need to convert arguments once before resolving the
owner, capture native methods before application code, preserve missing-attribute
and namespace behavior, and handle reentrant custom-element callbacks. Tests
would need ordinary and namespaced attributes, conversion with side effects,
protected targets, and pending and published frame source removal. The proposal
does not establish that all cross-realm cases can safely be admitted.

`createDocumentType` is another possible restriction to narrow for declarations
without external identifiers. It needs a separate review of XML construction and
insertion before any change.
