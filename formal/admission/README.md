# Bounded admission decision comparison

`Decision.tla` checks a narrow admission decision for two supplied resources.
It varies whether each supplied digest matches the bytes, whether their paths
and URLs are unique, and whether the entry path exists. TLC generates all 32
Boolean inputs and the expected acceptance/rejection outcome. The safe model
checks that it never accepts an invalid input; six fault configurations remove
one or two checks and must produce the specified counterexample.

Run from the repository root after installing Docker, the pinned TLA+ jar and
the project dependencies and Playwright Chromium and Firefox:

```sh
node formal/admission/run.ts
```

The runner regenerates the model outcomes with the pinned Java image and TLC,
then calls the real `admitInstallation` with all 32 selected combinations in
each browser. The unchanged valid fixture must be accepted, and every modeled
invalid combination must be rejected. These are tests of selected decisions,
not exhaustive tests of every input or proof of the JavaScript implementation.

The runner also builds test-only mutations from the actual source. Omitting
the digest comparison admits each independently tampered resource; omitting
the path check or missing-entry refusal also admits its invalid case. Removing only the
duplicate-URL check does **not** produce acceptance: a later resource-alias
validation independently rejects that particular fixture. Removing both path
and URL checks admits a fixture with identical paths and URLs, demonstrating
why that layered result must not be mistaken for a mutation-test failure. These
mutations change only isolated generated bundles, not production source.

`model-results.json` records TLC output, expected fault counterexamples and
model/config hashes. `implementation-results.json` records browser versions,
all decisions, actual mutation outcomes and hashes of the model, test runner,
admission source, lockfile and emitted bundles.

The model's digest bit abstracts equality with a computed digest; it does not
prove the hash implementation or its collision resistance. A publisher can
choose its own bytes and matching hashes, so a matching digest is an integrity
check across the installation boundary, not a claim that the code is benign.
The model fixes the remaining metadata, URLs, content and browser environment.
It does not model manager authentication, atomic storage commit, source-origin
rules, network effects, executable content safety, browser state, concurrent
mutation, or the entire admission function. These checks do not compose with
the lifecycle model into an end-to-end confinement proof.
