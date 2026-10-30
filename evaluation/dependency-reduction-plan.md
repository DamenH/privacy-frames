# Dependency and enforcement reduction

Preserve native application execution and the strict property that private data
cannot reach any server, including the runtime publisher. Keep the separate
GitHub Pages origins, installation without publisher execution, resource lists,
100 MiB admission limit and the current eight-application corpus.

## Work

1. Add a same-origin Connection Allowlist to generated runtime responses. Retain
   existing enforcement. Test the browser policy independently from CSP and API
   hooks, including synthetic service-worker responses, document and worker
   contexts, active receivers, same-origin traffic and unsupported browsers.
2. Evaluate DOMPurify as a replacement for passive-markup validation. Exercise
   default and host-specific adapters inside the actual private context. Compare
   rejected inputs and preservation of accepted content, including contextual
   parsing, templates, blob resources and SVG. Adopt only a replacement that
   removes custom responsibilities while preserving the required application
   behavior. Retain a reproducible candidate and an explicit decision if it fails.
3. Trace each local hardening family to its trusted consumers. Identify which
   consumers can move, which protections remain required and which code is
   unused. Implement supported deletions with appropriate hostile controls and
   measure the resulting code graph. Do not weaken hardening merely because the
   current application corpus passes.

## Qualification

Run type checking, formatting, unit tests, dependency-specific fixtures, trusted
boundary checks, the context suite, lifecycle, storage, network and the eight
application tasks/offline matrix. Record source and artifact provenance. The
runtime's existing protections must continue working where Connection Allowlist
is ignored. Compare dependency and local executable sizes with source
`b8c5b8e08b3ee1a2644924923ad98457e4c0f3f5`, including embedded code.

Keep production on the previous qualified release until qualification is complete.
Record the replacement decision and the remaining local responsibilities in the
completion audit.
