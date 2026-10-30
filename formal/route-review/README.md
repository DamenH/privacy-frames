# Browser route review queue

This queue makes the bounded [IDL join](../idl-surface-report.md) reviewable one
row at a time. It carries all 263 rows, including unobserved members and earlier
review pointers. It does not classify unreviewed members as safe. The observation
is only a property-name observation in the saved Chromium and Firefox profiles;
it is not evidence of callability, reachability, or a network effect.

```sh
python3 formal/route-review/generate.py
python3 formal/route-review/generate.py --check
python3 formal/route-review/generate.py --check --verify-wpt
```

The first command regenerates `queue.json` offline from the saved IDL report and
`triage.json`. The second detects drift, including changes to either input or the
generator. The third additionally downloads four selected Web Platform Tests (WPT)
at the recorded revision and verifies their content hashes. They are examples
for a reviewer, not tests of this runtime. WPT dependencies are not vendored or
verified by this command, and no WPT case is executed.

For each candidate, read the corresponding standard algorithm and identify the
required state, execution context, accessible data, receiver and browser-driven
effects. Record manual classifications and rationale in `triage.json`; select
WPT cases only after examining their relevance. Then design a native success
control and a confined receiver test. Record actual results and their provenance
in the claim ledger, including missing controls and remaining obligations.
Do not convert a source denial, a test name, or a browser property observation
into a security conclusion. The original join's review pointers are retained for
navigation, not promoted to evidence by this queue.

The keys bind a review to an exact specification, interface, member and kind;
all rows sharing that key receive the same review. Occurrence numbers distinguish
duplicate rows in the current report but are not stable across changed input
ordering. The source report does not preserve full overload signatures, so review
all overloads before relying on a classification. `--check` forces inspection
when the input changes, and generation fails if a reviewed key disappears.

This is a queue for 11 selected Webref specifications and two observed context
classes. HTML and CSS algorithms, HTTP headers, browser UI, operating-system
services, other specs, and additional execution contexts need separate inventories.
Completing the queue would not show that the browser has no other channels.
