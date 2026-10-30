# Confinement model

This initial model expresses preparation and publication, access to trusted
capabilities, and two classes of network effect. It is an abstract design
model, not a proof of the browser or TypeScript implementation. The boolean
fault switches are explicit assumptions: a successful safe check cannot prove
that actual browser mechanisms satisfy them.

`Safe.cfg` checks two contexts with all faults disabled. The other configurations
introduce one fault each and should produce a counterexample. The model currently
omits parent/child ownership, races in revocation, service-worker generations,
storage, browser channels and implementation correspondence. Those are required
before the agreed modeling work is complete.

To reproduce the current finite checks, install Docker and fetch the pinned TLA+
tool jar, then run:

```sh
mkdir -p .tools
curl -fsSL https://github.com/tlaplus/tlaplus/releases/download/v1.8.0/tla2tools.jar -o .tools/tla2tools.jar
formal/confinement/check.sh
```

The script checks the jar hash and uses a pinned Java image without network
access. The safe run explores 25 distinct states. Each fault configuration must
fail with its expected invariant violation. TLC's bounded state exploration does
not establish the completeness of the modeled browser actions.
