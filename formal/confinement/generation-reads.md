# Installation generations and in-flight reads

`GenerationRead.tla` models one installed application, one resource path, two
successive generation identifiers, two read slots and at most one replacement.
Each slot starts once. Replacement can retain the path with new bytes or remove
it. Tags 0 and 1 identify byte provenance; tag 2 means no body, not a third
generation. A caller may retain either generation that has already existed.
Future generation identifiers are not supplied before replacement.

## Source correspondence and timing

[`getResource`](../../src/runtime/storage.ts#L48) reads metadata and the requested
body in one readonly transaction over both stores. Its `oncomplete` handler
compares the saved metadata result with the expected generation and refuses a
missing body. It resolves the saved ArrayBuffer rather than looking up the body
again. [`putApp`](../../src/runtime/storage.ts#L77) replaces body records and
metadata, including a fresh generation, in one readwrite transaction over the
same stores.

The model assumes the browser implements
[IndexedDB transaction isolation](https://w3c.github.io/IndexedDB/#transaction-scheduling)
and atomic commits. It also assumes that stored values returned to the caller
are copies, consistent with IndexedDB's value semantics. TLC does not verify
these browser properties.

Four actions separate the relevant events:

1. `Begin` records the caller's expected generation. This can represent a context
   retaining old metadata, rather than a new database read.
2. `ReadTransaction` obtains a consistent metadata/body snapshot at the read's
   transaction linearization point. It does not mean that response delivery has
   occurred.
3. `Validate` represents the synchronous `oncomplete` check of those saved
   results. It does not recheck the database's later current generation. The
   abstract schedule leaves completion-task ordering unspecified beyond the
   transaction isolation assumption.
4. `Deliver` represents later observation of the already checked bytes by the
   caller or response consumer. It does not acquire another database snapshot.

An atomic `ReplaceTransaction` can occur between those stages. A read whose
snapshot predates replacement can therefore return old bytes afterward. An old
expected generation whose snapshot is taken after replacement is refused. A
replacement is not retrospective erasure of bytes already read, nor physical
termination of application JavaScript.

## Checks

The safe configuration checks these invariants over 286 distinct states:

- `TypeOK`: the state remains within the declared bounds.
- `ConsistentSnapshot`: accepted metadata and bytes belong to the same generation.
- `MatchesCallerGeneration`: accepted metadata matches the caller's expectation.
- `DeliveryUsesCheckedBytes`: delivery uses the bytes from the checked snapshot.

Each fault configuration changes one assumption:

| Configuration                    | Injected fault                                                       | Expected violation         |
| -------------------------------- | -------------------------------------------------------------------- | -------------------------- |
| `GenerationReadSplitRead`        | Read metadata and body separately, allowing replacement between them | `ConsistentSnapshot`       |
| `GenerationReadSplitWrite`       | Publish new metadata before replacing the body                       | `ConsistentSnapshot`       |
| `GenerationReadIgnoreGeneration` | Omit the expected-generation comparison                              | `MatchesCallerGeneration`  |
| `GenerationReadCurrentDelivery`  | Validate one snapshot, then deliver the database's later body        | `DeliveryUsesCheckedBytes` |

Three other configurations deliberately check false properties. They establish
that old bytes can be delivered after replacement, that a stale read can be
rejected, and that new-generation delivery can succeed. These counterexamples
are reachability controls, not defects in the safe design.

A representative safe late-delivery trace is `Begin(0)`, `ReadTransaction`,
`ReplaceTransaction`, `Validate`, `Deliver`: the saved metadata and bytes are both
from generation 0, although the database is now at generation 1. The full
counterexample output and input hashes are in
[`generation-read-traces.json`](generation-read-traces.json).

## Reproduction

Use the existing pinned TLA+ jar and Java container:

```sh
mkdir -p .tools
curl -fsSL https://github.com/tlaplus/tlaplus/releases/download/v1.8.0/tla2tools.jar -o .tools/tla2tools.jar
python3 formal/confinement/check-generation-reads.py
```

The checker verifies the jar SHA256, runs eight configurations in the pinned
`eclipse-temurin:21-jre` image with networking disabled, checks each expected
outcome and writes the receipt. Its recorded command uses one TLC worker and
turns deadlock checking off; terminal states are permitted. No fairness or
progress theorem is checked.

The browser fixture
[`test/context-generation.ts`](../../test/context-generation.ts#L67) separately
exercises twelve overlapping read/replacement pairs per engine with real
IndexedDB connections. The copied
[`generation-overlaps.json`](../evidence/generation-overlaps.json) records those
Chromium/Firefox observations. It accepts an old snapshot or rejection during
an overlap and requires a completed replacement to reject subsequent old-epoch
reads. The partial comparison below now checks these outcomes against the safe TLC graph.

The model does not include installation authorization, resource digests, browser
client identity, controller restart, child closure, private-data erasure, worker
termination, network channels, transaction aborts or multiple replacements.
Its snapshot invariants are independent of the separate lifecycle and admission
models until a composition or refinement argument connects them.

## Partial comparison with real IndexedDB outcomes

Run the browser fixture before the comparison to record current source behavior:

```sh
node test/context-generation.ts
cp results/contexts/generation.json formal/evidence/generation-overlaps.json
python3 formal/confinement/generation-trace-test.py
```

`generate-generation-graph.py` obtains 286 states and 482 labeled edges directly
from TLC. The comparison reads the copied `formal/evidence/generation-overlaps.json`. For each of
24 observed overlap/stale-read pairs, it searches this graph for a completion
with the observed outcomes. The browser fixture checks actual byte equality
before recording `old-generation`; that label is projected to provenance tag 0.
Each iteration treats its previous and replacement UUIDs as epochs 0 and 1.
There is no claim that all fourteen UUIDs fit one two-epoch model execution.

The projection requires the first invocation before the replacement commit. The
second invocation must follow both replacement completion and the first result.
Its expected epoch remains 0. Both an old first result and a refused first read
have possible completions. For each observed pair, four altered outcomes are
refused under every completion: first delivery of replacement bytes, first
delivery of missing bytes, and either old or new bytes returned to the stale
second request. The run accepted 24 observed pairs and rejected 96 altered
outcomes. Both valid first-result alternatives also have explicit reachability
checks, so rejection of all observations cannot pass the comparison.

The browser does not expose the transaction snapshot or validation events to this
fixture. The completion is an existential explanation of observations, not a
reconstruction of actual internal timing. The comparison omits the fixture's
intermediate fresh-generation read, and does not check arbitrary multi-read
histories, transaction aborts or multiple replacements within one trace.
`generation-implementation-traces.json` records witnesses, input hashes, fixture
hash and browser provenance; `generation-read-graph.json` records model/tool
hashes. Changing a rejected outcome cannot be excused by choosing another hidden
linearization, but an accepted outcome does not prove the implementation used the
modeled transaction structure.
