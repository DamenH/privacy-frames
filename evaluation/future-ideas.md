# Future design questions

## Boundaries retained by this prototype

The current target is network confinement after installation. Applications may
process private input, but their requests must receive admitted local resources or
fail. They must not reopen network-enabled installation or change the host's
policy and trusted setup code.

Applications share the runtime origin. Storage namespacing supports ordinary
application behavior; isolation between their stores and browser permission grants
is outside this prototype's guarantee. Separate origins per application would let
the browser enforce those distinctions. They would also change hosting,
service-worker registration and management communication.

The manager now coordinates installation on a separate origin and serializes
sessions across its tabs. Preparation downloads resources and may run restricted
publisher precaching. Interactive execution of the application interface remains
future work.

## Interactive preparation and updates

A future preparation session could run an application with network access and
exercise its features to discover additional resources. Its output would contain
resource bytes and metadata. JavaScript memory, live DOM objects, workers and
connections would not transfer; the confined application would start afresh.

Preparation must remain separate from runtime user data, including during
updates. Data migration would run inside confinement. Reusing a preparation origin
would require ending surviving contexts and dealing with persistent storage and
service workers. One active session simplifies capture ownership but does not
provide that cleanup.

A web app cannot inspect arbitrary response bodies merely by opening another
origin. Interactive capture needs control of the preparation environment and
CORS-readable resources. Publisher service workers may also compete with capture.
Exercising selected features would still leave unvisited code paths that request
uncaptured resources later.

## Prototype compatibility and runtime state

The current implementation permits selected array and string extensions and
polyfills. It protects existing array operations and reserved hooks, captures
native operations and uses explicitly protected internal collections and captured
string operations. Publisher behavior is not patched to pass these checks. Broader
prototype replacement needs its own investigation.

Evaluate restrictions against the confinement property. Observing an internal
record does not by itself establish network disclosure. Trace whether an exposed
reference permits changing enforcement, obtaining an unprepared context or
reaching an external receiver. Application corruption and cross-application data
access are different outcomes under the current threat model.

The runtime uses closures and WeakMaps for hidden state. ECMAScript `#private`
fields could help protect internal objects; TypeScript `private` annotations do
not provide runtime privacy. Operations on stored values still matter: invoking an
attacker-controlled method on a private array exposes that array as its receiver.
Symbol-keyed properties are discoverable through reflection on accessible objects.

Future architecture work can compare captured operations, protected internal
collections and separate realms. Administrative work belongs in the trusted host
where possible. DOM operations and context creation still require local adapters
that act while application code runs.

References: [private field access](https://tc39.es/ecma262/2025/multipage/abstract-operations.html#sec-privateget),
[reflective property enumeration](https://tc39.es/ecma262/2025/multipage/reflection.html#sec-reflect.ownkeys).

## Per-application permissions

A separate origin per installed application could separate browser permission
grants, including microphone access. Alternatives are trusted wrappers that add
per-application authorization, or an explicit policy accepting shared grants.
Current permission tests establish browser behavior and functionality; they do not
establish permission isolation between applications.

## Information flow control

Confinement supplies the communication boundary needed for later IFC work. A
literature review can examine coarse context labels, value and control-flow
tracking, isolated sensitive computations, model checking and developer-supplied
proof certificates. Any implementation that selectively releases information
would need a policy defining which outputs the user authorizes.

## Publisher-initiated installation

A publisher could link to an installation request on the trusted manager. The
user would approve installation there; the publisher would receive no management
authority.
