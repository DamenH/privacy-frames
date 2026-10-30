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
