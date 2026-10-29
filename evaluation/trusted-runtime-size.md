# Trusted computation: size measurements

The application keeps native scripts, modules, browser objects and WebAssembly.
The change moves our document compilation, fragment preparation and markup
validation into a private trusted context. Native enforcement hooks remain beside
application code. This measurement compares that implementation with source
`97f2b835609eedc95c9f52a470c7c32046f1b5fb`; it does not measure the abandoned
application-in-ShadowRealm design.

Run the comparison without rebuilding shared deployment directories:

```sh
npx tsx scripts/measure-trusted-runtime.ts results/trusted-runtime/size-snapshot.json
```

The script exports the historical source and copies the current working source
into temporary directories. Both use the installed dependency versions. It records
the dependency lock hash, plugin hash, runner hash, source-file hashes and a hash
of the copied tree. `sourceStableDuringSnapshot` must be true before using the
snapshot as a stable comparison. The working-tree hash identifies uncommitted
source; a HEAD revision alone does not identify this development build.

## Counting the private code

The production plugin embeds a compiled trusted entry as a JavaScript string.
Outer esbuild metadata sees that string as a virtual input, so counting only the
outer graph would hide its parser dependencies. The measurement runs the actual
plugin and independently builds its nested entry with the same settings. The
union of both input graphs counts each maintained source/dependency file once.
The virtual data module is excluded from that source union because its original
inputs are already counted.

Deployment totals include every byte of that string in each outer bundle. The
nested bundle size is reported separately and is never added to the deployment
total a second time. Both measurements use unminified production-target builds,
a fixed comparison build ID and gzip level 9. They are not public asset hashes.

Whole-file source counts include tree-shaken portions. Per-input emitted
contributions report the code retained by esbuild. Moving a parser file to a
private context is a reduction in local exposure, not a deletion from the
maintained implementation. A mixed file is conservatively charged to local
exposure even when only a small portion executes locally.

Placement has four categories:

- **Local executable:** reachable from a root/child guard or a dedicated,
  shared, publisher or worklet executor.
- **Mixed:** reachable from both one of those entries and the private entry.
- **Isolated only:** reachable from the private entry but no local executor.
- **Controller only:** reachable from the native service worker or management
  connector, with neither local nor private-entry reachability.

These describe build reachability, not a proof that callbacks or references
cannot cross the boundary. The private-context security tests establish that
separately. Manager React code, installer-only code and tests are outside the
runtime comparison.
An isolated-only input may also run in the trusted controller; the label means
it is absent from every executor that shares an environment with application code.

## Current development snapshot

[The parser-consolidation receipt](../results/trusted-runtime/size-parser-consolidation.json)
records stable source hash `3396b19b19ff4f671937191607c484881f23a7ea06ff57e8dc6d22d3cbf39471`.
The runtime now reuses Acorn for literal import relocation instead of shipping a
second JavaScript parser. A pinned, small import-phase extension preserves the
source/deferred syntax recognized by the previous lexer. The installer still uses
its existing lexer; this comparison covers the runtime graph.

| Measure                                   | Historical source | Current snapshot |   Change |
| ----------------------------------------- | ----------------: | ---------------: | -------: |
| Unique reachable project/dependency lines |            31,306 |           31,542 |     +236 |
| Unique reachable project/dependency bytes |         1,224,016 |        1,165,605 |  -58,411 |
| All runtime TypeScript lines              |            14,253 |           14,357 |     +104 |
| Eight deployed bundles, bytes             |         3,631,962 |        3,286,062 | -345,900 |
| Eight deployed bundles, gzip bytes        |           647,285 |          675,486 |  +28,201 |

Maintained runtime source and dependency bytes shrink by 58,411 bytes, and the
complete deployed runtime bundles shrink by 345,900 bytes. Source line count
increases: the removed lexer uses generated compact source, while the replacement
uses a readable extension and import traversal. This is a byte/dependency
reduction, not a claim of fewer TypeScript lines.

The private HTML parser remains fully counted, including the 326,431-byte embedded
bundle in each window guard. Both window guards have no executable parse5/entities
contributions. Native DOM hooks and remaining JavaScript analysis still execute
locally with their existing protections. The optional native isolation experiment
lives in the research harness; production has one private iframe implementation.

The [previous cleanup measurement](../results/trusted-runtime/size-cleanup.json)
was 60 source lines and 8,375 deployment bytes larger than the baseline. Parser
consolidation supplies the subsequent reduction. The new full AST parse also has
a different cost from lexical scanning; compatibility and startup observations
must accompany the size result.

## Earlier measurements

[The initial exploratory snapshot](../results/trusted-runtime/size-exploratory.json)
recorded source hash `0b31f710ebe41bb1c0913f8aa1d94bd54347f4cc2e6d24293b9ec1d2e3a53b61`:
+167 source lines and +114,027 deployment bytes. Parser module initialization
remained local despite private compilation.

[The policy-split snapshot](../results/trusted-runtime/size-policy-split.json)
recorded source hash `ca0fbf1ad0bcdd29edabc3c39b0fb201f57f9ce1edf7cb90d19258a537a69d10`:
+77 source lines and +98,880 deployment bytes. It still retained parser
initialization through the renderer's marker import. The current marker/types
split removes that dependency from both window executors. These receipts describe
intermediate source, not additional release verifications.

## Release status

These are development measurements. The implementation is still changing, and
the receipt does not qualify confinement, compatibility, startup cost or a public
release. A later stable snapshot must include the full nested graph again and
show separately whether total maintained code shrank and whether locally
executable code shrank.
