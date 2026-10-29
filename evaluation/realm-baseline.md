# Realm migration baseline

The baseline is source `97f2b835609eedc95c9f52a470c7c32046f1b5fb`.
Release evidence is committed at
`1a78033b48a64b72cd21b4467b96e7c7eba6a2f1`; it verifies the previous runtime,
not the proposed realm boundary. No replacement runtime has passed this audit.
The recoverable runtime publisher is `234fba3b4469ca243d2208e22b90b62aedaebd25`,
installer publisher `5f460f4b8aca4c87f1512861e269108761ac46b2` and application
publisher/list revision `f5de28d798237921e7d83467e9fa399dbb141b25`.

## Reproduce the code measurements

Run from this worktree after installing its pinned dependencies:

```sh
npx tsx scripts/measure-realm-baseline.ts 97f2b835609eedc95c9f52a470c7c32046f1b5fb > /tmp/realm-before.json
```

Run the same command with the replacement commit for the final comparison. The
script exports the requested Git revision into a temporary directory, bundles
without writing deployment files and removes its export on completion. It emits
file inventories, unique reachable source totals, individual bundle contributions,
SHA-256 hashes and gzip sizes. It does not modify the public build or checkout.

Source counts include comments and blank lines. Reachable dependency counts charge
the whole input file, including unused portions that tree shaking removes. Emitted
contributions show the corresponding tree-shaken cost. Neither count substitutes
for the other. Source is deduplicated across entry points; bundle totals include
copies shipped in different executors. Generated source maps, tests, manager React
code and installer-only dependencies are excluded from the runtime total.

The script resolves dependencies from the measuring worktree and records both its
lock hash and the historical lock hash. For this measurement every historical
package retained its version; the only additions were the four Near Membrane
packages at `0.19.1`. Comparing later revisions requires checking this again.
The fixed measurement build ID differs from a release ID, so these are comparison
bundles, not public asset hashes.

## Measured sizes

Measured with Node v26.2.0 and esbuild 0.28.2 on 29 October 2026. The full machine-readable output is `/tmp/pf-realm-baseline-97.json` in this
session; regenerate it with the command above rather than treating that temporary
path as a permanent release receipt.
An independent repeat produced the same hashes for all eight runtime bundles and
the membrane candidate. The measurement script passes its standalone TypeScript
check and formatting check.

| Scope                                                           | Files | Physical lines | Source bytes |
| --------------------------------------------------------------- | ----: | -------------: | -----------: |
| All `src/runtime` TypeScript                                    |    59 |         14,253 |      519,281 |
| Unique project inputs reachable from runtime deployment entries |    68 |         15,362 |      556,931 |
| Unique dependency inputs reachable from those entries           |    23 |         15,944 |      667,085 |
| Installer TypeScript, reported separately                       |     8 |          1,129 |       40,024 |
| Near Membrane browser ESM candidate, dependency inputs          |     5 |          5,248 |      237,825 |

Runtime dependencies comprise Acorn (6,341 lines), parse5 (7,980), entities (1,621)
and two generated module-lexer input lines. The source denominator for the runtime
migration is 31,306 reachable project and dependency lines, or 1,224,016 bytes.
The installer is not a source of runtime savings; it remains a separate role.

| Runtime deployment bundle |     Bytes | gzip bytes |
| ------------------------- | --------: | ---------: |
| Service worker            |   688,308 |    138,734 |
| Root window guard         |   999,447 |    183,758 |
| Management connection     |     6,637 |      1,954 |
| Dedicated-worker guard    |   292,024 |     42,136 |
| Child-document guard      | 1,004,943 |    184,485 |
| Shared-worker guard       |   298,598 |     43,263 |
| Worklet guard             |    31,833 |      7,093 |
| Publisher executor guard  |   309,959 |     45,871 |

The eight bundles total 3,631,749 bytes before compression. These are unminified
production-target builds using the existing entry formats, ES2022 target and
production environment definition. Startup does not download every executor, so
this total is a deployment cost rather than a page-load measurement.

The candidate is `@locker/near-membrane-dom@0.19.1`, MIT, upstream revision
`236f91016ecf7f0ed88de4f6847fcc584434d03f`. Its ordinary browser import reaches
`near-membrane-base`, `near-membrane-shared`, `near-membrane-shared-dom` and the DOM
package's devtools formatter. An isolated ESM build is 183,375 bytes, or 26,819
gzip bytes. It exports the ordinary package entry; no local library fork or
application bridge is included. This is an incremental candidate cost, not the
size of an integrated fallback. Count the integrated graph once at the final gate.

## Where code can disappear

Window isolation can remove the need to protect trusted JavaScript by modifying
the application's built-in prototypes. It can also replace raw-window facades
with one scoped handle system. These changes do not remove the policies enforced
by the existing wrappers.

| Existing responsibility                                    | Baseline size | Migration consequence                                                                                                                      |
| ---------------------------------------------------------- | ------------: | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `intrinsics.ts`, `bindings.ts`, `contexts/window-realm.ts` |     827 lines | Window mutation setup can shrink; worker fallback still needs local protection. Do not count all three files as deleted.                   |
| `shared/primordials.ts`                                    |     170 lines | Trusted window code can use its own intrinsics; code beside worker publishers still needs captured operations/private records.             |
| `enforcement/*`                                            |   2,146 lines | Hook installation can become bridge dispatch. Navigation, effect, script, markup and storage decisions remain.                             |
| Document factory, popup factory and renderer               |   2,240 lines | One handle/lifecycle path can replace repeated facades and setup. Rendering, preparation ordering and native default-action checks remain. |
| Worker/shared/worklet context files                        |   2,592 lines | Creation and controller decisions remain; portable worker guards cannot be deleted merely because window code moved.                       |

The membrane adds 5,248 dependency lines before the shared facade and module
loader exist. The clearest 827-line window-setup group is smaller than that cost,
and is only partly removable. A net reduction therefore needs a demonstrated
larger simplification; it cannot be inferred from removing prototype protection.
For example, removing parse5 from the entire runtime graph would remove up to
9,601 dependency lines including entities. It currently enters through shared
policy, document compilation and the document factory, so deleting one import
does not earn that saving. Native parsing must retain admission and markup checks
before any such replacement counts.

Use `deleted reachable project/dependency code - added reachable
project/dependency code` for the final saving. Report emitted and gzip costs
alongside it. Do not offset added runtime code with installer or test deletions.

## Native context observations

An isolated loopback HTTP page was tested with fresh Playwright browsers. A Blob
dedicated worker reported its globals. A real `AudioWorkletNode` received a report
from its processor constructor after `audioWorklet.addModule`. All browsers,
workers, audio contexts and the temporary server were closed. This was an API
availability probe, not confinement or DSP verification.

| Browser/profile                                             | Window `ShadowRealm` | Dedicated-worker `ShadowRealm` | Audio-worklet `ShadowRealm` |
| ----------------------------------------------------------- | -------------------- | ------------------------------ | --------------------------- |
| Chromium 153.0.8010.12, `--js-flags=--harmony-shadow-realm` | function             | function                       | function                    |
| Chromium 153.0.8010.12, ordinary launch                     | undefined            | undefined                      | undefined                   |
| Firefox 155.0, ordinary launch                              | undefined            | undefined                      | undefined                   |

The dedicated workers exposed `fetch` and `Worker`; the audio worklets exposed
neither. All reported `HTMLIFrameElement` as undefined. Shared-worker and paint
worklet realm availability were not measured. A constructor's presence does not
establish safe evaluation, imports or browser-object bridging.

Flagged Chromium could support a native worker realm adapter, but that would not
supply the ordinary Chromium/Firefox fallback. Their actual worker threads need
a restricted local environment. An iframe cannot implement that environment in
a worker. Moving those computations to a main-thread window would lose native
parallel execution and termination semantics.

## Worker and worklet policy placement

`worker-realm.ts` currently installs resource aliases, checked `importScripts`,
alternate-transport restrictions, scoped storage and nested context factories
before loading publisher code. It also preserves the publisher's logical
location. `worker-guard.ts` captures the bootstrap message and private control
port before enabling application messages. `shared-worker-guard.ts` separately
authenticates connections against the controller's redemption route and checks
the application and installation generation.

The service worker already owns context identities, parent/client bindings,
generation checks, admitted resource routes and connection grants. Keep that
authority there. The new trusted window can own native Worker objects, immediate
message transfers, pre-start queues and termination. The service worker cannot
construct a Worker on behalf of that window. Nested creation can request an
owning trusted controller, but its observable startup and transfer timing still
need a concrete adapter before local factories can be removed.

Portable worker-local code must still prevent direct WebSocket/WebTransport and
other effects that do not pass through the resource controller. It must guard
`importScripts`, module and Blob entry paths, worker construction and constructor
recovery, and retain private bootstrap channels. Public globals and prototypes
must not disclose saved native constructors or corrupt local enforcement.
Moving an identity record to the parent does not remove these transport paths.

`worklet-guard.ts` takes a narrower approach: it rejects startup if unadapted
HTTP/storage globals appear, installs effect restrictions and seals bindings.
`worklet-factory.ts` registers module loads with the controller; `worklet-source.ts`
adapts only admitted module sources. Keep real processor execution and ports in
the browser's worklet. A remote window cannot replace the processor callback or
its real-time lifetime. The fallback can remain a small guarded profile if the
actual browser globals stay within the audited surface.

Publisher service-worker behavior uses prepared SharedWorker executors rather
than native publisher service workers. Its `publisher/guard.ts` calls the same
worker preparation before delivering install/activate/fetch/message events.
Registration, client RPC and controller authority must remain distinct. Window
realm isolation does not by itself eliminate this executor's local guards.

## Measurements still required for Milestone 1

This baseline establishes code and bundle costs, context availability and the
retained local enforcement. It does not establish a smaller bridge or qualify
either realm backend. Startup, representative DOM interaction and image-buffer
copy/transfer costs need paired measurements in the actual shared-adapter
harness. The previous release's installation timings measure downloads and
capture, not window-realm startup; they cannot fill that gap.

Before full migration, the harness must establish classic-script lexical/global
semantics, modules and callbacks without exposing a host object, synchronous
event cancellation, native constructor/prototype compatibility and a buffer path
that avoids per-byte bridge calls. The measured membrane cost makes the code
reduction gate substantive. If those requirements need a second loader/policy or
more maintained code than they remove, record the failed gate before production
integration.
