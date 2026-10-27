# Confinement review

## Scope and method

The baseline is host revision `b4dbf2e6367929cf216d883eaf90a5167e587253`.
Fresh baseline checks and response-policy hashes are retained under
`results/evaluation/baseline/`. Chromium 153.0.8010.12 and Firefox 155.0 ran with
normal third-party storage partitioning restored by `test/browser-profile.ts`.

The primary implementation review traced each boundary below through source and
existing regression tests. Two delegated adversarial reviews were rejected by the
agent platform before producing findings. Their rejection supplies no security
evidence. A narrower independent documentation/evidence audit was requested
separately. This review does not substitute for an external penetration test or a
confinement proof.

## Areas assessed

| Area | Source examined | Checks and assessment |
| --- | --- | --- |
| Native references and live objects | `guard.ts`, `enforcement/native.ts`, `enforcement/dom.ts`, `resource-aliases.ts` | Native references are captured before application execution. The existing token-list receiver regression checks getters, methods and iteration with unrestricted controls. The iterator returns copied strings rather than retaining a native policy object. |
| Reentrancy and scheduling | `enforcement/navigation.ts`, DOM wrappers, cache wrappers, guard script startup | Found a repeated URL conversion in history wrappers; normalized once before passing to the browser. Guard installation precedes application markup and scripts, including asynchronously loaded scripts. |
| Parsing and insertion | `shared/policy.ts`, installation and runtime document processing, `enforcement/dom.ts` | Lexical and parsed gates cover HTML, SVG, MathML and template contents. Creation, parser, insertion and attribute paths have synchronous restrictions. Existing probes include real events and unrestricted native controls. The lexical gate remains deliberately conservative inside text and comments. |
| Execution contexts and navigation | `enforcement/navigation.ts`, `enforcement/effects.ts`, `response-policy.ts` | CSP and protected APIs deny frames, popups, application workers and worklets. A native Navigation API listener cancels document exits. External embedding/opener tests remain separate from ordinary request tests. Browser menu actions and browser defects are outside scope. |
| Storage | `enforcement/web-storage.ts`, `storage/indexed-db.ts`, `storage/caches.ts` | Namespaces apply at native factory prototypes; Web Storage handles and storage-event fields expose scoped views. Cache match options cannot replace the final prefixed cache name. Tests read back same-app data and check cross-app access and enumeration. Shared origin quotas and timing are not isolation guarantees. |
| Routing and admission | `runtime/worker.ts`, `runtime/admission.ts`, `shared/runtime-url.ts` | Worker derives identity from actual clients, admits exact resource URLs and queries, and rejects unknown requests without network fallback. Full source digests govern storage; short aliases are collision checked. Admission reconstructs metadata and checks bodies and hashes before storage. |
| Management and lifecycle | `bridge/connect.ts`, `manager/services/runtime-bridge.ts`, worker management handlers | Bridge checks the real parent window and configured origin. Worker independently requires a role issued for a trusted bridge navigation and bound to its browser client ID. Existing tests call worker management through a test-only captured native capability. Replacements/removals reject active app windows. |
| Installation execution | `installation/import-website.ts`, `prepare-worker.ts` | Publisher preparation receives a compartment with a download broker and in-memory caches. Explicit lifecycle promises finish before the native worker is terminated and installation returned. No native publisher controller survives into confined execution. |

## Changes and findings

The history wrapper previously validated `String(url)` and passed the original
object to the native method, which could convert it again. The wrapper now passes
the checked string. This closes a check/use mismatch; no network disclosure or
cross-application storage access was demonstrated through this route. A regression
compares conversion counts with the unrestricted native method in both browsers.
The Navigation API remains an independent navigation control.

The compatibility study found that the importer rejected `application/ld+json`
metadata. Initial inline JSON and JSON-LD blocks now remain data elements; they do
not become executable resources. External data-script resources and unsupported
script types remain rejected by preparation. Existing script mutation and
insertion controls also apply to these elements. Unit tests and browser controls
check readable JSON, nonexecution, blocked type mutation and blocked reinsertion.
This change does not add dynamic executable script support.

Independent network checks require live DNS, HTTP/TCP and STUN UDP controls.
The retained baseline receipts show zero private-marker network observations for
the calibrated routes. Fresh post-change receipts are kept separately from the
baseline. Page-reported refusal alone is not treated as evidence of no traffic.

## Limits

No new confirmed network-disclosure escape was established in this review.
Coverage is finite: newly introduced browser APIs and browser behavior changes
require renewed review. No WebKit or real-device mobile conclusion follows from
the two desktop browser runs. Application workers, arbitrary updates and IFC
remain outside this implementation round.
