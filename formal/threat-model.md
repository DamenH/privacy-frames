# Confinement threat model

An adversary controls the entire installed application, including dependencies,
markup, scripts and any publisher-provided worker code. The adversary can choose
inputs, invoke available browser APIs, schedule asynchronous work, create supported
child contexts, modify permitted prototypes and attempt to impersonate a manager.
The host, its installation and controller code, its dependencies, the browser and
the operating system are trusted. Browser defects and malicious extensions are
outside this argument.

The target property is stricter than testing whether a particular payload contains
a secret: while an untrusted application executes in confinement, an
application-caused remote request or connection must not occur. This includes the
runtime origin. The property covers URL, body and header channels without requiring
value-level taint tracking. Explicitly authorized exports require a separate policy.

Trusted installation may use the network. No publisher code executes during that
phase, and private input is not handed to the installer. Private data can remain in
runtime-origin storage across executions or later installations. The installer runs
on a different origin; the claim that it cannot read that private state is an
implementation and browser obligation, not a consequence of a local storage name.
Applications may share runtime-origin storage and browser permissions. Their
namespace separation is a compatibility feature, not an assumption of confidentiality
between applications.

Sharing application data does not grant applications authority over the host's
admission records, management roles, context bindings or other enforcement state.
The integrity of that state is part of the confinement argument and requires
separate verification.

The policy covers application-caused explicit network effects, including ordinary
HTTP, resource loads, navigation, DNS names influenced by the application,
WebSockets, WebTransport and WebRTC. It does not claim protection against physical
side channels, denial of service, developer tools, malicious extensions or
intentional browser-menu exports. Browser housekeeping and trusted host updates may
use the network only under an explicit assumption that application-controlled
private data cannot influence those requests. That assumption requires evidence;
merely calling a request browser housekeeping does not establish it.

The first models abstract each effect into a boolean and do not model bytes,
timing, DNS, individual browser APIs, malicious browser behavior or the complete
host implementation. In particular, their network invariants are conditional on
fault switches being disabled. They test the coherence of the abstract design;
they do not establish those switches are disabled in a real browser.

## Runtime contract

Confinement must be established before any application-controlled code or markup
can execute in an application context. This includes private data already in
storage: a relaunch does not provide an unrestricted initialization interval.
Installation may download publisher resources on its separate origin, but it
must neither execute publisher code nor obtain runtime private state.

An external observation includes an outgoing request or connection, its
destination, method, URL, headers and body, and its occurrence and order. Where
application execution can determine when such an effect occurs, that timing is
also observable. The inventory must include browser operations that transmit
without producing a service-worker fetch event and local handoffs to actors
that can transmit on the application's behalf. The physical and operating-system
exclusions above do not exempt browser APIs that request remote communication.

The initial state includes existing registrations, permissions, policies, pending
operations and other retained browser state. A newly installed application does
not imply a fresh browser profile. Each relied-on initial-state condition must
be established by setup, enforced as a supported-environment prerequisite, or
remain an explicit unresolved obligation. Lack of a browser API for inspecting
a state does not establish that the state is absent.

Trusted maintenance is permitted only when its observable behavior is independent
of application-controlled private execution under the declared observation
model. A fixed URL does not establish independence: choosing whether or when to
contact it may disclose information. The proof must identify which maintenance
behavior is independent and why. Unsupported independence assumptions prevent
the complete claim even if ordinary application fetches are blocked.

## Shared invariants

The following identifiers are proof obligations, not assertions that the current
implementation has satisfied them.

| ID  | Obligation                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | No application code or markup executes before its local context preparation succeeds.                                                                               |
| C2  | Every usable authority exposed to an application is harmless under this policy or mediated by an adapter that preserves confinement.                                |
| C3  | Returned objects, getters, callbacks, promises, messages and new contexts preserve the authority boundary, including asynchronous and reentrant execution.          |
| C4  | Every external effect and pending browser-owned operation reachable from application execution is covered by the effect policy.                                     |
| C5  | Application mutation of permitted prototypes and state cannot modify enforcement state or invalidate the captured operations used to enforce the policy.            |
| C6  | Management, admission and context authority come from authenticated browser actors and validated host state; application assertions of identity grant no authority. |
| C7  | Replacement, closure and revocation deny new unauthorized grants; operations already in flight preserve confinement through completion or cancellation.             |
| C8  | Requests obtain immutable admitted local resources or fail. Failure never introduces network fallback or publishes an unprepared context.                           |

Publication means granting usable execution authority. A mediated handle may be
returned before preparation if every operation on that handle preserves C1–C8.
A persistent phase label alone does not grant publication. For each context kind,
the proof must identify the native operation or protocol event that first makes
application execution or authority usable.

Revocation needs an explicit linearization point for each affected grant or
resource read. A record marked closed does not by itself establish native
termination, cancellation of a pending effect, or invalidation of a retained
handle. Previously admitted computation may continue only while it preserves
confinement. Any stronger termination property relied on by an adapter requires
its own implementation and browser argument.

The proof target is conditional on specified browser and toolchain contracts.
Those contracts must describe concrete native behavior; assuming that all
application effects are mediated would assume the conclusion. The implementation
and coverage arguments must establish C1–C8 for the declared environment.
