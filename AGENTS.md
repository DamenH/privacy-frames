# Working on Privacy Frames

## Code

- Write implementation, examples and build scripts in TypeScript. Use React for
  the manager interface and Tailwind for its styles. Keep runtime setup independent
  of React rendering.
- Follow the checked-in Prettier configuration: two-space indentation, single
  quotes, trailing commas and a 90-column print width. Use ordinary whitespace,
  one statement per line and descriptive names. Run `npm run format:check`.
- Group code by execution environment and responsibility. Prefer small modules
  with explicit inputs over a collection of generic wrappers. Keep the guard's
  initialization order visible.
- Define shared types for messages, installation metadata and resources. Treat
  external input as unknown until runtime validation succeeds. Do not silence
  boundary errors with casts, `any`, `@ts-ignore` or disabled compiler checks.
- Capture native methods before untrusted execution. Refactoring must preserve
  the timing and authority of those captures and the order of guard setup.

## Security and compatibility

- During confined execution, an application request must receive an admitted
  local resource or fail. Never add network fallback for compatibility.
- Establish all required restrictions before loading application markup or code.
  Refuse startup when the browser cannot establish the required controls.
- Validate installation data again at the runtime admission boundary. Types alone
  do not validate messages or downloaded data.
- Authenticate management using actual browser windows, origins and client roles.
  An application-provided URL, identity or role cannot grant management authority.
- Preserve application-scoped storage, including prototype and event routes.
- Keep publisher resources off the trusted manager and runtime origins. Paths
  within a single origin are not separate security principals.
- Use general web semantics for compatibility. Do not branch on publisher names,
  domains or a particular application's generated filenames. New compatibility
  behavior needs an independent fixture that explains the general rule.
- Remove superseded paths and formats. This greenfield project has no legacy
  publisher format or old runtime route to preserve. Host service-worker lifecycle
  correctness still matters across normal development releases.

## Verification

Run type checking, formatting and tests appropriate to the change. For admission
or enforcement changes, include hostile attempts and working unrestricted
controls. A page-reported error alone does not prove that no request escaped.
Keep exact browser versions and revision provenance with release evidence.

Do not present historical receipts as verification of new code. Distinguish
local tests, public deployment tests, desktop PWA installation and real-device
mobile tests. Describe unverified support accurately.

## Writing

Use direct prose that a reader outside the development conversation can follow.
Explain the actor and mechanism before relying on implementation vocabulary.
Give each paragraph a purpose; delete closing sentences that merely repeat its
point or add a generic caution. Preserve negation when it states an actual
security restriction.

Keep the report focused on the problem, threat model, mechanism and evidence.
Detailed commands and test receipts belong in implementation documentation.
Use the unslop skill for prose reviews, with a sentence-by-sentence pass after
structural editing. Do not replace technical precision with a phrase-scanner score.
