# Context support implementation

The implementation and release checks are complete; their receipts are listed in
the [completion audit](COMPLETION.md). This document retains the agreed scope and
verification gates.

## Approved scope

Keep third-party applications unchanged. Move the existing importer and restricted
precaching to a separate installation origin; do not run the application UI during
installation. Serialize installation sessions across manager tabs through runtime
admission.

Retain successful captures when ordinary dependencies fail. The entry document,
host preparation, resource limits and runtime admission remain mandatory. Missing
resources must fail locally during execution. Failed publisher precaching must
not commit partial contributions.

Broaden language compatibility through general runtime controls. Test exposure of
pending contexts, recovery of forbidden communication APIs, modification of trusted
bootstrap resources and access to the network-enabled installer. The prototype
retains storage namespacing, but does not guarantee cross-application storage or
browser-permission isolation on the shared runtime origin.

The fixed corpus is PhotoCraft, Pitch Training, the Wikipedia article,
Excalidraw, Squoosh, diagrams.net, StackEdit and CyberChef. Useful tasks and offline
behavior are separate from installation. Final delivery includes the tested host,
runtime and installer on separate GitHub Pages origins and an updated report.

## Current source

The context adapters are implemented for dedicated workers, shared workers,
worklets, child HTML/SVG documents and popups. Dynamic classic/module/Blob scripts
run in already prepared realms. Publisher service-worker events run through
prepared executors; the host retains native controller and response authority.
Autonomous custom elements and application-scoped same-document history are also
implemented.

Contexts carry application and installation-generation identity. Native browser
client identifiers bind roles where available. Narrow resource bearers cover
supported requests that lack a usable browser client identifier; they cannot
perform management or arbitrary resource reads. Children inherit their parent's
application graph and receive no installation or management authority.

Pending frames are initialized inside closed shadow roots. Their usable Window
and Document references stay unavailable until preparation succeeds, then native
state-preserving movement publishes them. The first response is a trusted
bootstrap; publisher content is admitted afterward. Root and child documents use
the same compiler/renderer, with a viewless native markup check before live
insertion. Indexed/named-window behavior needs browser-specific fixture coverage.

Trusted runtime source now calls private collection/record helpers and captured
operations explicitly. There is no custom build-time runtime transform. Public
prototypes for Object, Array, Map, Set and other reviewed language types can accept
extensions without making trusted records inherit those fields. Native operations,
implicit protocols, intrinsic ancestry and Error stack hooks remain separately protected.
Selected replacements used by ordinary polyfills are supported through captured
trusted operations.

Installation, runtime and manager are separate origins. Installation still uses
static resource discovery and restricted precaching. Partial captures include
missing-resource diagnostics; the runtime has no fallback to the publisher.
Finite static resource discovery handles supported loader expressions and embedded
worker code within explicit bounds, without executing the application.

## Remaining gates

| Gate                      | Required evidence                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Full regression suite     | Fresh unit and two-browser context/storage/management tests on the final build                                   |
| Prototype compatibility   | Ordinary extensions work; hostile hooks cannot receive private native contexts or replace enforcement operations |
| Context lifecycle         | Pending, replacement, cancellation and recursive creation retain the intended authority checks                   |
| Application corpus        | Unchanged bytes, useful task, offline repeat and explicit failures for all eight applications                    |
| Independent network tests | Active native DNS/HTTP/TCP/UDP controls and no confined disclosure on the calibrated routes                      |
| Public release            | Built-artifact/source provenance, Pages deployment and fresh public installation/task checks                     |

Local receipts describe individual tested versions, including earlier intermediate
profiles. They do not establish that the final combined build passes every gate.
CyberChef cancellation/restart remains unverified in Firefox; native-control
failures must be recorded rather than treated as confined successes.

Interactive installation, general updates, IFC, extensions and stronger per-app
origin/permission isolation remain outside this batch.
