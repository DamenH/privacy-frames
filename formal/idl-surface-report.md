# Joining native feature names to WebIDL

[The generator](idl-surface-report.py) joins the saved native browser snapshot to
11 specifications from Webref's pinned, parsed WebIDL. Run it with Python 3 and
network access:

```sh
python3 formal/idl-surface-report.py
```

[The report](evidence/idl-surface-report.json) records each input URL and SHA-256,
the generator and snapshot hashes, exact browser versions, and 263 member rows.
It includes partial interfaces and distinguishes static operations from prototype
members. The saved snapshot covers Chromium 153 and Firefox 155; generating the
report does not launch a browser or claim that current browsers match it.

Each row has separate native-name observations and a manually curated review
pointer. An observation means a property name was found without invoking its
getter. The review pointer names relevant source or a fixture; its status says
whether that reference supplies a receiver control, a source restriction, or a
more limited result. A source restriction does not become receiver evidence by
being included in the ledger.

The current bounded report has 166 observed rows without a review annotation.
These include ordinary local data access such as `Request.headers` as well as
candidate effect entry points. They are absent from this small ledger, not
necessarily from all existing tests. No keyword filter decides which operations
are effects.

## Useful next targets

| Member or acquisition route                                                    | Snapshot observation                                        | Next evidence needed                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ServiceWorkerRegistration.backgroundFetch` and `BackgroundFetchManager.fetch` | Chromium Window and dedicated-worker constructor prototypes | The [background-agent probe](background-agents.md) has a native Chromium download control and tests recovery of a pre-existing native registration. Prepared-worker acquisition remains untested. |
| `ServiceWorkerRegistration.sync`, `SyncManager.register` and periodic sync     | Chromium Window and dedicated-worker constructor prototypes | The same probe calibrates one-shot sync and tests native registration recovery. Periodic sync lacked a successful permission control; a registered sync event alone is not an observed outbound request. |
| `IdentityProvider.close` and `IdentityProvider.resolve`                        | Chromium static names                                       | Read their algorithms and establish whether they initiate network effects. Their presence does not justify denying them; the existing FedCM result concerns other static methods.                                                                             |
| `Window.fetchLater`                                                            | Chromium only                                               | Existing source denies the method. A native delayed-upload control would establish whether a future regression can be detected.                                                                                                                               |

The credential-management entries also distinguish `get`, which has the scoped
FedCM control, from `create`, `store` and `preventSilentAccess`, which currently
have source-denial pointers without equivalent receiver calibration.

## Limits of the join

WebIDL defines bindings, not complete network behavior. It does not enumerate
browser-generated reporting, CSS/HTML fetch algorithms, HTTP-header-driven state,
DNS effects or UI operations. In particular, a ReportingObserver declaration is
not the API that causes the modern browser uploads reproduced by the reporting
fixture.

Mixin resolution is deliberately bounded. `WindowOrWorkerGlobalScope.fetch` is
mapped to the two captured globals; other mixins remain unresolved rather than
being attributed to every similarly named interface. Navigator and Document
chains are captured only in Window. WorkerNavigator, service-worker globals,
shared workers and worklets are not represented by this snapshot. Missing
constructor tables therefore have an explicit unknown observation, not an
unsupported-feature conclusion. Constructor rows witness a constructor property,
not successful construction, permission availability or usable platform state.

IDL overloads remain separate rows. Specification exposure attributes and
inheritance are retained in the pinned inputs but are not a complete browser
reachability graph. The next extension should resolve includes and inheritance
from the full pinned corpus and expand the snapshot's actual context types,
without invoking getters merely to enumerate them.

WPT can supply relevant algorithm and receiver-control examples after an entry is
selected for review. WPT filenames and IDL conformance tests do not establish that
this runtime mediates an operation. A useful coverage ledger needs explicit
member-to-fixture links, the tested browser/profile, state prerequisites, and an
independent receiver outcome. The report's curated pointers provide a small start
without treating a WPT name match as a passing security test.
