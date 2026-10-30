# DOMPurify replacement experiment

DOMPurify 3.4.17 is pinned as a development dependency. It is absent from the
production runtime graph. The experiment tests replacing passive-markup
validation; application script execution, context preparation and resource
admission remain separate responsibilities.

Run `node test/markup-dependency.ts` after building the project. The
[receipt](../results/dependency-reduction/markup-candidate.json) records Chromium
and Firefox, source provenance and the returned markup for every case.

## Candidate

The candidate executes the published DOMPurify bundle inside the same detached
private iframe used by production trusted computation. Requests and replies are
strings. The native DOM stays inside that context. Application prototype changes
do not alter its results in the tested routes.

The factory initializes before detachment. Its default Trusted Types integration
cannot run callbacks after the frame detaches in either tested browser. The
supported `TRUSTED_TYPES_POLICY: null` configuration avoids that dependency;
production does not currently require Trusted Types. This setting does not
provide compatibility with a future policy that requires TrustedHTML.

Three outputs are compared: DOMPurify defaults, a host-specific string adapter,
and a host-specific contextual adapter. The latter parses into an inert native
element matching the requested parent before sanitizing that element in place.
It preserves table fragments and templates that the string adapter changes.
Only returned sanitized markup is eligible for insertion. `removed` is recorded
for diagnosis and never used to authorize original input.

The host adapter retains the default sanitizer protections, forbids direct
context/policy elements and selected active attributes, and adds the platform's
navigation-target predicate. It permits ordinary custom-element names and
attributes. It does not add SVG animation or foreign-content exceptions, or
replace the default URL policy with an application-specific allowlist.

## Results

Both browsers produce passive output for eight hostile fixtures, including
script-bearing attributes, executable URLs, popup targets, nested contexts,
resource hints and namespace-confusion input. The fixture inspects the returned
native tree, including template content. These observations are not a network
confinement or exhaustive XSS proof.

The contextual adapter preserves eight of twelve benign fixtures. Four accepted
uses change in both browsers:

| Input               | Candidate output                 |
| ------------------- | -------------------------------- |
| Blob image          | Resource URL removed             |
| Blob audio          | Resource URL removed             |
| SVG foreign content | Embedded foreign content removed |
| SVG animation       | Animation element removed        |

The old acceptance column in the receipt describes the shared parse5 validator,
not the complete current runtime. For example, the native validator separately
rejects executable URLs that the shared parser gate alone accepts. The receipt
must not be read as a comparison of complete security guarantees.

## Decision

Keep the existing production validators. DOMPurify is a credible sanitizer, but
this candidate does not preserve the required markup contract. Supporting the
changed cases would add policy exceptions and require further security analysis.
Its guarantees exclude CSS and reliable HTTP-leak prevention, so the network
and context gates would remain our responsibility.

The candidate adapter is 76 lines and bundles to about 79 KB uncompressed. The
current shared validator is 90 lines and native validator is 229 lines. Those
native checks use the actual HTML/XML parsing context and inherited namespace
declarations; the production private interface does not currently convey that
whole context. Neither validator can be deleted on the evidence from this
experiment. parse5 also remains necessary for document compilation and child
context preparation, so adopting DOMPurify would not remove that dependency.

The maintained comparison remains in `test/dependency/markup-policy.ts`. It
adds no second production sanitizer or runtime backend.

Sources: [DOMPurify](https://github.com/cure53/DOMPurify),
[security goals](https://github.com/cure53/DOMPurify/wiki/Security-Goals-%26-Threat-Model).
