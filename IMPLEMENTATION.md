# Implementation boundaries

The source separates the manager, installer and confined runtime onto three
origins. The manager owns installation approval. The installer downloads public
resources and runs restricted precaching. The runtime admits the resulting
package and serves installed resources without network fallback.

The configured sites are `pf.damenh.com`, `install.pf.damenh.com` and
`apps.pf.damenh.com`. All three are deployed on GitHub Pages. The
[completion audit](evaluation/COMPLETION.md) records the verified source, public
application tasks and network checks.

## Source structure

| Directory                         | Responsibility                                                                |
| --------------------------------- | ----------------------------------------------------------------------------- |
| `src/manager/`, `src/manager.tsx` | React interface, installation approval and runtime connection                 |
| `src/bridge/`                     | Authenticate management connections and forward fixed operations              |
| `src/installation/`               | Installation sessions, resource capture and restricted precaching             |
| `src/runtime/worker.ts`           | Authorize browser clients, admit installations and serve local resources      |
| `src/runtime/guard.ts`            | Prepare the root application before its markup or scripts run                 |
| `src/runtime/contexts/`           | Prepare documents, popups, workers, shared workers and worklets               |
| `src/runtime/publisher/`          | Mediate publisher service-worker behavior without granting native control     |
| `src/runtime/enforcement/`        | Browser operation policies and the native markup validator                    |
| `src/runtime/storage/`            | Application-scoped IndexedDB and Cache Storage interfaces                     |
| `src/runtime/storage.ts`          | Host-owned installation metadata and resource bodies                          |
| `src/shared/primordials.ts`       | Captured operations and explicit private collection/record helpers            |
| `publisher-source-ref.txt`        | Pinned source for maintained examples and unchanged third-party copies        |
| `scripts/`, `test/`               | Static builds, functional fixtures, hostile controls and network observations |

## Installation boundary

Installation starts from a webpage URL, without a custom application manifest.
The manager creates a disposable installer iframe and authenticates its exact
origin, window and session before transferring a MessagePort. A host Web Lock
serializes installations across manager tabs through runtime admission. The
installer accepts one preparation request and is removed before admission.

The existing importer runs on the installation origin. It does not execute the
application UI. HTML, CSS, module references, bounded static loader discovery and
restricted precaching feed the same resource collection. Publisher preparation
receives a limited download broker and in-memory caches inside an SES compartment;
the host-owned preparation worker is terminated before admission.

Downloads omit credentials and reject redirects. Missing ordinary dependencies
are recorded while successful captures are retained. A missing entry document,
failed host preparation, exceeded limit or invalid package still rejects the
installation. Failed publisher precaching contributes no partial cache writes.
The limits remain 1,000 resources and 100 MiB per installation.

The runtime independently checks metadata, paths, markup, byte counts and digests
before publishing an installation. Installation success establishes an admitted
resource graph; useful application behavior requires a separate task test.

## Runtime boundary

The initial response contains only trusted setup. Root and child documents admit
publisher content after common preparation succeeds. Resource aliases map original
publisher URLs to exact installed responses. The service worker rejects uncaptured
runtime requests, and CSP restricts ordinary requests to the runtime origin.
WebSocket, WebRTC and other alternate effects also require explicit API controls;
CSP alone does not block a same-origin WebSocket.

The runtime creates and prepares dedicated and shared workers, worklets, child
HTML/SVG documents and popups before publisher execution. Pending document
references remain unavailable. Context identity includes the application,
installation generation and actual parent; a child receives no management role.
Root history updates may stay within the installed application's URL namespace.
Document exits and unsafe history traversal remain restricted.

Dynamic scripts use installed resources or application Blobs. An uncaptured script
is redirected to a local unavailable-resource response so native asynchronous
failure behavior can be retained. Autonomous custom elements are supported;
customized built-ins and document replacement remain restricted. Before live
markup insertion, a viewless native parser checks the actual nodes in addition to
the compiler's checks.

Trusted callbacks use captured operations and explicit private arrays, Maps, Sets,
records, descriptor records and native option objects. These objects do not inherit
application prototype additions. The public language profile permits ordinary
prototype and metadata extensions, including Object, Map and Set extensions.
Selected public replacements, including String methods and
`Function.prototype.toString`, leave the captured trusted operations intact.
Protected native operations, intrinsic ancestry, implicit coercion/iteration/then/JSON
hooks and Error stack hooks retain separate restrictions. No custom build-time transform
rewrites trusted runtime code.

Publisher service-worker registrations and events are mediated through prepared
executors. Registration scopes in the physical installed namespace map back to
the corresponding publisher scope; this does not expand the admitted resource
graph. Scope validation uses captured native URL getters. Setup and executor
rebinding have deadlines; publisher event jobs have no fixed processing timeout.
The executors cannot replace the host controller, obtain arbitrary network access
or authorize responses outside the admitted graph. General application updates
remain deferred.

## Storage and management

Host IndexedDB separates installation metadata from resource bodies. Full
source-derived identities govern namespaces; the 11-character URL alias is
collision checked. Local storage, session storage, IndexedDB and Cache Storage
have application-scoped views. The prototype does not promise cross-application
storage or browser-permission isolation within the shared runtime origin.

The manager embeds the trusted runtime bridge. Both endpoints check browser-issued
origin and actual peer window before exchanging a MessagePort. The worker also
requires a management role bound to a trusted browser client. Top-level
applications launch without openers; application content cannot become a manager
or an installer by supplying a URL or role field.

## Builds and evidence

The build emits separate static manager, runtime and installation sites for GitHub
Pages. Publisher examples are served from independent origins. Development uses
separate local origins for the same roles.

Receipts must identify the source, built artifacts and browser tested. Existing
release receipts describe their recorded revisions. Fresh full regressions,
corpus tasks, independent network checks and public deployment are required before
this batch can be called a verified release.
