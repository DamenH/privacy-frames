# Implementation boundaries

The source has four execution environments: the manager document, the runtime
bridge, a disposable preparation worker and the confined application document.
The host service worker controls installed application responses. Each boundary
has explicit data validation and a distinct set of capabilities.

## Source structure

| Directory | Responsibility |
| --- | --- |
| `src/manager/`, `src/manager.tsx` | React library interface, installation state and runtime connection |
| `src/bridge/` | Authenticate the manager iframe connection and forward admitted management operations |
| `src/installation/` | Download a webpage, discover resources and finish public preparation |
| `src/runtime/worker.ts` | Authorize browser clients, admit installations and serve local virtual resources |
| `src/runtime/guard.ts` | Establish restrictions before loading application markup or scripts |
| `src/runtime/storage/` | Application-scoped IndexedDB and Cache Storage interfaces |
| `src/runtime/storage.ts` | Host-owned installation metadata and resource bodies |
| `src/shared/` | Shared types, runtime validation, resource limits and URL identity |
| `publisher-source-ref.txt` | Pinned `privacy-frames/apps` source for ordinary and hostile fixtures |
| `scripts/` | Static builds for both trusted origins and independent examples |
| `test/` | Browser behavior, hostile probes and independently observed network tests |

## Installation boundary

Installation starts from a webpage URL. There is one importer and no external
host-specific package format. HTML, CSS, supported module dependencies and
precache installation all feed the same resource collection. Transformations
resolve publisher URLs and prepare initial markup before runtime admission;
they do not add publisher-specific branches.

Downloads omit credentials, reject redirects and enforce the shared limits while
reading response bodies. Preparation code receives a limited download broker and
in-memory caches inside an SES compartment. The native preparation worker is
host-owned. It is terminated before the installation crosses into runtime
storage.

The runtime independently validates received installation metadata, resource
paths, markup, byte counts and digests. TypeScript types describe internal code;
they do not authorize data received through browser messages. Failed validation
must leave the installation unpublished.

## Runtime boundary

The host worker serves an initial document containing only the guard. The guard
captures native methods, freezes language intrinsics and establishes restrictions
before admitting application markup and scripts. Setup failure prevents
application execution.

Network confinement combines two controls. A runtime-origin-only CSP prevents
external request destinations, including measured DNS disclosure routes. The
host worker serves exact installed resources and rejects other runtime-origin
requests. Publisher URL aliases are translated before native request creation.

The guard also covers operations outside ordinary HTTP interception: navigation,
new execution contexts, alternate transports, browser-mediated remote services
and access to unscoped storage. Dedicated workers, shared workers and worklets
remain prohibited. The detailed operation inventory is in
[SURFACE_INVENTORY.md](SURFACE_INVENTORY.md).

A limited precache registration interface lets supported PWAs inspect their
completed installation. Publisher registration, update and fetch-handler
execution never gain native runtime authority. General application updates remain
outside the current profile.

## Storage and identity

Host-owned IndexedDB separates installation metadata from resource bodies. Library
listing and alias lookup read metadata without copying every installed resource.
Resource bodies are loaded when needed for a response. This uses browser-managed
origin storage; the 100 MiB admission limit is an application policy.

The full source-derived identity governs storage namespaces and ownership. The
11-character public alias is a URL convenience, with collisions rejected during
admission. Application display names confer no authority. The guard namespaces
local storage, session storage, IndexedDB and Cache Storage, including prototype
calls, enumeration and storage events.

## Management boundary

The manager embeds a trusted bridge from the runtime origin. Both endpoints check
the browser-reported origin and actual peer window before exchanging a
MessagePort. The bridge accepts a fixed operation set. The worker independently
requires a management role bound to a trusted browser client.

Applications launch top-level without openers and cannot be embedded by an
external parent. Same-site manager and runtime domains allow iframe installation
and top-level execution to share runtime storage. The bridge checks storage
access and worker control before proceeding.

## Builds and evidence

The build emits separate manager and runtime sites for both local testing and
production. A small second repository exists only to publish the runtime through
GitHub Pages; implementation and fixtures stay together here. Untrusted examples
are built separately and published on independent origins.

Changes to admission or enforcement require both working unrestricted controls
and confined attempts. Network observations use external receivers and process
tracing in addition to page-reported errors. Receipt provenance must identify the
revision and browser tested. Existing receipts provide historical evidence until
the changed implementation is tested again.
