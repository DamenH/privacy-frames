# Runtime confinement verification

This work implements the eight-stage plan for a compositional confinement
argument. The baseline is host revision
`6a2ce294d3d8717e7a6b207d064891c45fea4e11`. Development uses the
`runtime-confinement-proof` branch in a separate worktree. The baseline's models,
source checks and browser receipts retain their documented scopes.

The target is the contract in [the threat model](../threat-model.md). Applications
remain ordinary JavaScript, including asynchronous execution and prototype
modification. The host remains a static web application. Publisher-specific
patches, new publisher packaging requirements, extensions and native hosts are
outside this implementation plan. Application storage namespaces remain a
compatibility feature rather than a confidentiality boundary.

## Stages and acceptance criteria

1. **Security contract.** Define the confinement boundary, initial browser state,
   trusted components, external observations and shared invariants. Identify
   proof obligations for each assumption. Acceptance requires an explicit policy
   for application-influenced browser maintenance and retained state.
2. **Implementation mapping.** Map context creation, publication, native authority,
   callbacks, asynchronous suspensions, deferred effects and revocation to actual
   implementation entry points. Every identified authority-producing operation
   needs an owner and a contract. Unknown operations remain obligations.
3. **Context publication.** Connect the executable root, child-document, popup,
   dedicated-worker, shared-worker, worklet and publisher protocols to unbounded
   lifecycle arguments. Cover authentication, usable returned authority, queues,
   exceptions, cancellation, replacement and closure. The proof must account for
   actual persistence and native lifetime behavior.
4. **Implementation-verification method.** Compare deductive JavaScript verification
   with generation from a verified executable specification on a stateful
   publication component. Choose one production method using measured results.
   Record language, heap, callback, compiler and annotation requirements. The
   chosen method must establish more than source-shape matching.
5. **Admission and effect adapters.** Verify immutable admitted resources, canonical
   identities, executable content, delivery, messages and generation changes.
   Specify each native adapter's input authority, returned references, callbacks
   and immediate or deferred effects. Remove unnecessary authority or duplicated
   policy when the proof and compatibility evidence justify the change.
6. **Browser coverage.** Review effect-producing specification algorithms as well
   as interfaces: markup, CSS, headers, navigation, stored policies, background
   agents, permissions and contexts. Assess WebSpec on concrete obligations.
   Each relevant mechanism must be mediated, unavailable in the declared
   environment, or unable to produce a forbidden effect for an established reason.
   Omitted mechanisms cannot discharge coverage.
7. **Browser validation.** Challenge each relied-on contract with applicable native
   controls, confined executions, independent receivers and isolated removal of
   actual enforcement. Include retained state and lifecycle schedules. Record
   source, build, browser configuration and observation bounds. Missing positive
   controls remain missing evidence.
8. **Composition and publication.** Prove initialization and preservation of the
   shared invariant and its implication for external effects. Connect executable
   components to the modeled transitions. Publish the statements, correspondence,
   assumptions, unresolved obligations and reproducible checks. Validate relevant
   security tests and application compatibility before deployment; verify public
   bytes and a fresh installation afterward.

Full conditional confinement requires both implementation correspondence and
browser coverage. A proved component, bounded model, passing test or completed
inventory does not establish the other stages. If a web-platform limitation
prevents a required boundary, record a reproducible counterexample and the
missing primitive. Do not substitute a different host architecture or weaken the
contract to close the item.

## Initial findings

The existing `ContextRegistry` serializes mutations within one instance.
`formal/confinement/registry-concurrency-test.ts` includes a schedule in which two
instances accept bindings for the same browser client. The controller store uses
separate CacheStorage writes for the record and index. The lifecycle proof must
either establish that the conflicting browser requests are unreachable, repair
the synchronization, or establish why the permitted outcome preserves the actual
confinement invariant. An atomic binding operation cannot simply be assumed.

Persistent `preparing`, `ready` and `running` labels do not establish local guard
readiness. Dedicated-worker message delivery opens after the prepared worker has
registered an application listener. Child documents use an authenticated parent
channel before rendering. Their implementation correspondence needs separate
arguments even where the abstract publication contract is shared.

## Progress

- Stage 1: contract being specified and reviewed against current behavior.
- Stage 2: entry-point review started; complete authority mapping remains open.
- Stage 3: pending; the existing concurrency schedules have been reproduced.
- Stage 4: deductive-mode calibration passes; comparison on an actual stateful
  publication component and production-method selection remain pending.
- Stages 5–8: pending. Earlier component evidence remains available, with its
  original assumptions and source hashes.

The complete runtime claim remains unestablished.

## Implementation review inventory

Run `node formal/runtime-verification/inventory.ts` to generate
`implementation-inventory.json`, then rerun with `--check` to detect drift. The
typed definitions in `boundaries.ts` identify 13 review boundaries across 50
source files and connect them to C1–C8.

The generated inventory locates calls, constructors, asynchronous suspensions,
returns and selected reference bindings, with enclosing function scopes and
source hashes. It does not resolve aliases, follow dependencies or establish
authority closure. Display snippets are truncated; review the hashed source at
the recorded location. The 6,102 recorded syntax sites are review inputs rather
than a security-coverage measure.

## Deductive-mode calibration

Run `node formal/runtime-verification/method-calibration.ts` with Docker available.
The runner retrieves the upstream stateful ID-generator example at a fixed source
revision and checks its digest. The three procedure contracts describe the
returned closure, identifier generation and reset. Gillian's `verify` mode accepts
all three. Removing the state increment produces a failed postcondition in the
identifier procedure. A compilation error or tool crash does not satisfy that
negative control.

The receipt records the input, runner, image digest and output hashes. Analysis
runs with container networking disabled. This calibration establishes that the
pinned tool performs deductive checking on that stateful fixture. It does not
verify our publication code. The JavaScript compiler, verifier and solver remain
trusted; the container image does not identify its source revision. The next
comparison must exercise actual publication state and its adapter contracts.
