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

## Context liveness bookkeeping

The controller no longer advances ContextIdentity through preparing, ready and
running when it serves content or acknowledges readiness. Production permission
checks only distinguished closed from live. The local guard, rather than those
controller labels, establishes preparation.

The existing serialized vocabulary, parser and policy version remain unchanged.
A normal controller update can therefore read a prior controller's ready/running
record, and an old controller can finish an outstanding write. There is no new
migration branch, format, user-data reset or compatibility adapter. New code
continues to bind with the existing preparing representation and does not write
the two later live labels. Closed records and all closure tombstones remain.

The removed state transitions also performed authorization reads. Those checks
were retained explicitly: both new revalidation methods serialize through the
same registry queue, compare the full expected authority stamp, and perform two
effective reads. Child content revalidates after intent consumption. Root content
revalidates after the generation-checked resource read. Readiness preserves its
request-shape, actual-caller/bearer and installation-generation checks, then
revalidates the original capability. The ready RPC and private guard handshake
remain in place.

The measured source change is a modest four formatted lines removed across four
production files. Fresh-context startup avoids two ContextStorage.put calls,
which previously wrote both identity and index: four CacheStorage.put operations
per context. Replayed readiness already performed no live-phase writes. The
simplification removes a misleading phase-transition machine rather than
loosening a browser API restriction.

Deterministic tests cover an earlier queued close, closure or changed ownership
from another registry during an awaited read, old-controller writes after
closure, and unchanged duplicate-bind limitations. The Registry model now uses
one bound state for the three live persisted labels. Its eight-state graph and
10,000 actual operation traces retain closed-authority and wrong-owner controls.
The document-controller test also pauses after content consumption and checks
closure and authority changes before delivery.
Browser receipts cover workers, documents, shared workers, publisher workers and
same-URL controller replacement before child publication.

The [eight-app corpus run](evidence/compatibility-after-context-cleanup.json)
passed every task except Chromium's Excalidraw installation, where downloading
a font failed. A [targeted retry](evidence/compatibility-cleanup-excalidraw-retry.json)
passed its native and confined tasks. Both receipts retain the source and build
hashes; the retry does not turn the earlier failed run into a single clean run.

Authorization still linearizes at a checked effective snapshot. A close that
commits afterward is not a promise that all already-buffered bytes or JavaScript
stop instantaneously. These tests do not establish global cross-controller
linearizability or eliminate the separate duplicate-binding race.
