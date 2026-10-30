# Confinement claim ledger

[`ledger.json`](ledger.json) links a bounded set of communication routes and
authority decisions to the code, tests, model results and open obligations that
bear on each one. It records native controls, confined tests, actual fault
controls, abstract model faults and trace comparisons as different evidence.
An older vulnerable build is recorded separately from an isolated mutation of
the current defense.
`reviewed-scoped` means only that the recorded route and evidence have been
reviewed; it is not a claim of complete mediation. `unverified` identifies a
route for which the ledger records no established mitigation.

Run the offline structural and drift check from the repository root:

```sh
python3 formal/claims/check.py
```

The checker requires each claim to name its prerequisites, enforcement, source,
evidence and remaining obligations. It checks every referenced file's SHA-256
against the reviewed snapshot. A mismatch calls for review; do not update a hash
without checking the changed code or evidence and its effect on the claim. The
source baseline is a navigation aid. Changing an unrelated file or committing
documentation does not itself invalidate the ledger.

Each entry records whether a native control, confined test and runtime fault
control are linked. `not-recorded` means this ledger does not establish one; it
does not assert that no such test exists elsewhere. A model counterexample is
listed separately and cannot count as a runtime fault control.

Hash equality is not a security proof. In particular, it does not establish that
a historical browser receipt describes the current build, that the cited test
ran successfully, or that a source file contains all the relevant enforcement.
Read the receipt's revision, browser, control and scope before relying on it.
The initial evidence includes historical receipts alongside newer fixtures;
their scopes are not interchangeable.

This is a first ledger, not a complete browser API catalog. The separate
[Web IDL report](../idl-surface-report.md) lists additional observed names that
have not yet been annotated. New browser interfaces, browser-owned state,
non-JavaScript effects and untested contexts remain review obligations. The
target is an argument about application-caused remote effects, not isolation
between applications that share storage and permissions.
