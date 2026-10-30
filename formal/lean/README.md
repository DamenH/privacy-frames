# Conditional authority-graph proofs

These Lean proofs are deliberately smaller than the host. They give an
unbounded mathematical statement about a boundary, not a proof that JavaScript
or a particular browser satisfies it.

`Reachability.lean` proves that if the app's starting object is in an allowed
set, every outgoing edge from an allowed object stays in that set, and no object
in that set grants network authority, then no finite chain of reachable objects
grants that authority. It also proves that an arbitrary finite sequence of
edge additions preserves the conclusion when each addition checks the target
of an allowed source. A separate checked counterexample shows a two-edge path
from an app through an intermediate object to a socket when the closure rule is
broken.

`CapabilityBoundary.lean` states a second, simpler obligation: if an app starts
without network authority, can gain only a local capability and a remote effect
requires network authority, then no finite execution sends. A checked fault
example grants the network capability and reaches a sending state.

The key conditions are not proved for the runtime. To apply these theorems one
must establish that every usable JavaScript/DOM/browser authority and every
way to obtain or use it are represented by the graph and effect rule; that
native browser-created effects cannot bypass that representation; and that
setup and all later operations maintain the edge rule. Capturing methods,
controlling contexts and denying named APIs are candidate implementations of
these obligations, not proofs of them. In particular, FedCM and reporting show
why a graph that includes only obvious JavaScript properties is insufficient.

The proofs do not model installation, asynchronous callbacks, revocation,
resource data, native prototypes, browser state or network protocols. Other
models and receiver tests cover selected pieces of those mechanisms. There is
no verified translation or refinement proof connecting TypeScript to these
definitions.

## Reproduce

Download the official Lean 4.35.0 Linux release into `.tools/`, verify its
published SHA-256, and extract it:

```sh
mkdir -p .tools
curl -fL https://github.com/leanprover/lean4/releases/download/v4.35.0/lean-4.35.0-linux.tar.zst -o .tools/lean-4.35.0-linux.tar.zst
printf '%s  %s\n' 7289597a44543246c9227b8cae501767e095ce17f6d448b95fc4a8dc97268f6d .tools/lean-4.35.0-linux.tar.zst | sha256sum -c -
tar --zstd -xf .tools/lean-4.35.0-linux.tar.zst -C .tools
python3 formal/lean/check.py
```

The checker uses `--trust=0`, verifies the tool version, requires the named
theorems to have no axiom dependencies, and fails on other proof output. Set
`PF_LEAN` to a Lean 4.35.0 binary to use an existing installation. The release
archive is approximately 594 MB. Lean and its kernel remain part of the trusted
verification toolchain.
