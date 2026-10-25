# Next implementation: installation without a connection tab

Status: implementation in progress. Updated 2026-10-26.

This plan covers the discussion after the last completed implementation round.
It is intended to be executable in one autonomous pass, including testing,
publication and an updated report. Implementation was authorized after the planning discussion.
The completed release gates remain recorded in `IMPLEMENTATION_PLAN.md` and
`results/release.json`.

## Agreed result

The library stays at `https://pf.damenh.com/`. Installed applications move to
`https://pf-apps.damenh.com/`, with addresses such as:

```text
https://pf-apps.damenh.com/ywJX53taGnk/pitch-training/#/reference
```

Both sites must actually be hosted on GitHub Pages, with their custom domains
configured in repository Pages settings and DNS. A Pages page that merely forwards
to a Cloudflare-hosted application does not meet this requirement. Cloudflare
continues to provide DNS; no application backend or request proxy is introduced.

The manager automatically connects to a trusted runtime document in an iframe.
There is no Connect Runtime button, connection tab, popup permission requirement
or instruction to keep a second window open. A normal Refresh action may remain
beside the library. Opening an application is a separate, explicit user action.

The pass also adds short application addresses, generic document import,
publisher-manifest inheritance and individual PWA installation. Wikipedia is an
independent compatibility test, not a special integration. The browser-local
glyph indicator is deferred for further design. Extensions are excluded from the design.
Fine-grained IFC, arbitrary application workers, application-controlled service
workers and general application updates remain future work.

## Evidence and starting state

The plan was reconciled against the post-release discussion and current working
trees. Research session logs remain private and are not published with the code.

The host repository is `/home/damen/Projects/privacy-frames`, at `e5082f0` when
inspected. The fixture repository is `/home/damen/Projects/privacy-frames-apps`.
The latter working tree was clean. The host has uncommitted manager/UI changes,
test selector changes and a changed `results/browser.json` from the interrupted
UI work. Review these individually; do not discard them or count the receipt as
evidence for the new release. Several tests still expect a popup even though their
button selector has been renamed. They need substantive updates.

At the start of this round, the live manager and runtime used Cloudflare static assets. The current
GitHub Pages host artifact is an entry point. The fixture repository's old Pages
configuration uses `pf-apps.damenh.com` as an optional publisher hostname. That
hostname is now assigned to the trusted runtime; its former use is superseded.

The current runtime stores full source-derived installation identities. Its URL
parser, storage namespaces, management client roles, resource aliases and CSP all
depend on that identity. Public shortening must preserve these relationships.
The existing calibrated DNS/TCP/STUN checks are required regression evidence,
including the Firefox DNS behavior that led to local resource aliases.

## Boundaries to preserve

| Component | Authority |
| --- | --- |
| Trusted manager on `pf.damenh.com` | Network-enabled preparation, library UI and authenticated management requests |
| Publisher installation execution | Disposable execution with an installation network broker; no existing private state or host management authority |
| Trusted bridge on `pf-apps.damenh.com` | Authenticate the manager, commit validated packages, list/remove installations and return runtime observations |
| Installed application | Its installed resources and scoped private state; no external network fallback or new unrestricted execution context |

Installation may contact external services, including destinations that would be
forbidden during confined execution. There is no claim of network confinement
during preparation. Its network broker remains credential-free and bounded;
host integrity, CORS and isolation from existing private data still apply.

The transition is explicit: finish preparation, stop its execution and outstanding
broker requests, validate and commit the package, then start a fresh application
document with enforcement active before publisher code or private-state access.
Do not try to revoke the authority of a still-running unrestricted page in place.
Do not broaden this work into arbitrary live-site recording during installation.

The bridge is trusted host infrastructure. Its existence does not permit apps to
create frames. The bridge must not become a general network proxy or grant
management authority based only on a same-origin message, claimed URL or name.

## Execution order and acceptance gates

### 1. Establish actual Pages builds and the iframe feasibility gate

- [ ] Separate manager and runtime artifacts by role. The runtime Pages artifact
  contains trusted bootstrap/bridge/runtime assets only. It must not publish the
  unrestricted hostile fixtures or ordinary publisher applications at other paths
  on the runtime origin. Repository co-location does not imply origin safety.
- [ ] Use the two existing repositories as the two Pages sites: `privacy-frames`
  publishes the manager; `privacy-frames-apps` publishes the trusted runtime built
  from the host repository. Host implementation source remains in one place.
  Keep the independent publisher domains working on their existing static hosting.
- [ ] Make the second workflow consume an explicitly pinned, tested host commit,
  using a workflow input or committed release reference. Record the host and
  fixture revisions in both release artifacts. Do not build runtime from a
  moving `main` while claiming it matches the tested manager release.
- [ ] Audit reliance on Cloudflare `_headers`, `_redirects`, exact-file routing
  and content types. Implement the necessary behavior in portable static files,
  document metadata and service-worker responses. Do not add a Worker routing
  dependency to make Pages appear to work.
- [ ] Exercise a minimal same-site, cross-origin trusted iframe: service-worker
  registration/control, IndexedDB, Cache Storage and localStorage written in the
  iframe must be visible to an application launched top-level on that origin.
  Include browser restart, fresh profile and persistence checks.
- [ ] Run Chromium and Firefox checks, plus WebKit where the local automation
  supports these APIs. Use a same-site local HTTPS test setup or the actual HTTPS
  domains; different loopback ports alone do not cover all production behavior.
  Retain a separate deliberately cross-site storage-policy test.
- [ ] Feature-detect relevant storage access behavior. If permission is needed,
  present a small trusted in-page permission step with a genuine user gesture.
  A hidden iframe cannot be assumed to have activation. Check the actual storage
  and controller operations after permission; a cookie-access result is not proof
  that every required API works. Permission rejection must leave installation
  uncommitted and report a useful error, without opening a tab automatically.

Gate: the manager can install and enumerate an application through the iframe,
and the top-level application sees the same committed installation and storage.
No connection tab is created. An unsupported browser fails clearly; do not weaken
the origin boundary or silently reinstate a popup to make a test pass.

### 2. Replace the connection protocol and remove the extra UI

- [ ] Replace `window.open`/`window.opener` coordination in `manager.js` and
  `connect.js` with the host-created iframe and authenticated MessageChannels.
  The manager checks the exact frame window and runtime origin; the bridge checks
  the actual parent window and configured manager origin. Use exact target origins.
- [ ] Restrict embedding to the intended trusted use where the hosting/browser
  mechanisms permit it; message authentication remains mandatory independently.
- [ ] Preserve service-worker management roles bound to genuine browser clients.
  Recheck role issuance on worker activation, navigation and reconnection. App
  history changes, forged parent messages or a copied bridge URL must not grant
  a management role.
- [ ] Keep the operation set explicit. The runtime bridge has no reason to fetch
  arbitrary publisher URLs: preparation happens on the manager side. Limit its
  network behavior to the trusted bootstrap lifecycle and remove any inherited
  general manager-network exception that the bridge no longer needs.
- [ ] Handle frame load, readiness, controller replacement, timeouts, rejection,
  page restoration and pending-request cancellation. Reuse one connection and
  avoid leaking transferred ports or racing two package commits.
- [ ] On startup, load the library automatically through the bridge. Retain only
  useful user controls: URL, Install, examples, installed apps, Open, Remove and
  optional Refresh. Keep the existing concise dark UI, Report and GitHub links.
- [ ] Replace tests that click Connect/Refresh and wait for a popup with tests
  that install from a fresh visit directly. Count pages before/after installation
  to prove that the connection creates no extra tab, including mobile viewports.

Gate: first installation, library refresh, removal and manager reload work without
exposing runtime connection plumbing. Hostile messages from apps and other origins
cannot list installations, remove them, install packages or invoke preparation.

### 3. Implement short, source-bound addresses

- [ ] Retain the complete internal identity and existing storage namespace.
  Derive the public alias from the first 64 digest bits, encoded as unpadded
  base64url: 11 characters. It is an identifier, not a credential or content hash.
- [ ] Store/resolve the alias uniquely against the full identity. Explicitly
  detect collisions and refuse an ambiguous installation without overwriting
  either app. Test with forced collisions rather than hoping to encounter one.
- [ ] Use `/<alias>/<readable-name>/` as the canonical entry address. The name is
  a canonical label; a missing/incorrect name resolves to the same installation
  and redirects locally to its correct label. The alias determines identity.
- [ ] Hide the entry filename in the launch address, preserve the app's fragment
  verbatim, and adapt resource URL generation, HTML/CSS aliases, module imports,
  bootstrap requests and identity parsing together. Check non-index entry files,
  trailing slashes, query handling and path traversal/encoding variants.
- [ ] Reserve trusted asset/bridge paths so aliases cannot overlap them. Route
  recognition must not allow one app to fetch another's resources or private data.
- [ ] On a browser with no installed copy or no controller, the remote URL serves
  no publisher code. Any missing-installation/help handling must be trusted and
  static; never fall back to fetching the publisher or running an unchecked copy.

Gate: Pitch Training opens with one name, an 11-character alias, no `index.html`
and a working `#/reference` route. Changing only the label cannot change the
installation, storage scope or authority. Reload and offline relaunch still work.

### 4. Improve generic document installation

Use one installation path for ordinary websites and documents. Do not add
MediaWiki-specific URL detection, adapters, resource rules, markup rewriting or
privileged exceptions. The goal is that suitable third-party documents install
unchanged by using the same general browser URL/resource semantics as other apps.

Relaxed installation network access permits public resource discovery and capture;
it does not by itself implement that discovery or fix the current markup admission
rules. Generic preparation must still produce a locally runnable document before
the fresh confined execution begins.

The exact reported example is:
`https://en.wikipedia.org/w/rest.php/v1/page/Albert_Einstein/html`.
It returned readable HTML with CORS `*` when inspected. Its `<base>` element
triggered our context-producing-markup error; that diagnosis does not establish
that every image or stylesheet is already importable.

- [ ] Parse base URL metadata during public preparation, implement document base
  resolution, and remove the original base element before runtime admission.
  Keep runtime `base-uri 'none'` and reject dynamic attempts to add/change it.
  Test multiple/invalid bases, base targets and relative/query/fragment references.
- [ ] Replace the blanket lexical base rejection for prepared source documents
  with parser-aware handling. Keep genuine context-producing markup prohibited,
  including inside templates and alternate parsing routes. Improve refusal
  messages so a metadata issue is not described as a new execution context.
- [ ] Discover and capture ordinary document dependencies: stylesheets,
  nested CSS imports/URLs, images and relevant responsive/lazy-image references.
  Avoid recursively installing ordinary navigation hyperlinks or every possible
  responsive image size. Measure the resulting file/byte budgets and make any
  bounded limit changes explicit.
- [ ] Preserve same-document navigation; external article links remain subject
  to the existing navigation restriction. Fetching arbitrary new articles after
  confinement is not part of this pass.
- [ ] Keep CORS requirements, credential omission and installation limits.
  Diagnose a missing/unreadable dependency by URL and cause. No backend or
  credentialed proxy is introduced to bypass publisher policy.
- [ ] Add deterministic generic document fixtures with equivalent base/resource
  behavior, and test the exact live Wikipedia endpoint separately. Exercise
  visible article text, representative images, styles and offline reload.
- [ ] Add the verified Wikipedia example to the manager. Also verify a small
  independently developed application, such as the previously investigated MDN
  Web Storage example, if exposed as another example. Do not attribute an
  original application's lack of persistence to the host without a control.

Gate: the reported article imports and renders from captured resources offline.
Private runtime requests do not escape through article links, images, CSS, base
resolution or missing resources. A fixture passing alone does not prove the live
article is supported; record any concrete publisher-side blocker honestly.

### 5. Preserve publisher manifests and support individual PWA installation

- [ ] Read the original manifest link before HTML preparation strips it. Capture
  its presentation metadata and local icon resources during public installation.
  Resolve its relative URLs against the publisher manifest's actual URL.
- [ ] Preserve supported name/short name, description, language/direction,
  colours, display preferences and orientation. Adapt launch preferences and
  in-scope shortcuts where they fit the admitted application. Manifest absence,
  malformed JSON and unreadable optional metadata need explicit tested behavior;
  they must not grant new authority or unnecessarily break an otherwise valid app.
- [ ] Generate a host-owned manifest for each installation, with a stable
  `id` based on its alias, scope `/<alias>/`, and a local canonical start URL.
  Keep identity independent of a label change and use publisher start routes only
  when they resolve to an admitted local document/route. Supply fallback metadata
  and suitable host-provided icons for apps without a usable manifest.
- [ ] Serve the manifest and icons locally through routes available to the
  browser's actual manifest/icon fetches. Those fetches may not carry the same
  client identity as app fetches; do not weaken the entire gate to accommodate
  them. Expose only validated public metadata/assets through narrowly defined
  read-only routes.
- [ ] Permit the host's generated manifest link in the trusted document policy.
  The imported publisher manifest does not supply arbitrary executable handlers,
  widen network policy or register its own service worker. File/share/protocol
  handlers, push, background sync and automatic app updates remain unsupported.
- [ ] Keep the host service worker authoritative for every installed PWA. Native
  application workers remain denied. Verify cold launch and offline startup reach
  the same guarded bootstrap before private state is accessed.
- [ ] Verify at least two different app identities/manifests/scopes on one runtime
  origin, independent local state, matching publisher presentation, and correct
  hash-route launch. PWA scope is not a new security or storage boundary.
- [ ] Automate Chromium's available installability/installation/launch facilities
  where possible and inspect the actual resulting app identity and start URL.
  Separate native installation evidence from manifest inspection. Record WebKit
  automation and real-device coverage accurately; a mobile-sized viewport is not
  an Android/iOS home-screen installation test.

Gate: supported browsers can install individual confined apps using their own
names/icons and launch them through the host. The report distinguishes host
support from browser-specific PWA installation UI and support.

### 6. Run security and functionality acceptance checks

- [ ] Preserve Notes, Image editor, Reader, Adversary, Playground, the ordinary
  PWA and unchanged Pitch Training. Check rendering, interaction, scoped storage,
  audio, microphone lifecycle, saved scores, hash routes and offline relaunch.
- [ ] Update hostile fixtures for iframe-message spoofing, manager privilege
  recovery, manifest/shortcut/icon tricks, alias collisions and cross-app paths.
  Include concurrency: another app may hold private state while a new public
  installation is running.
- [ ] Preserve tests for new execution contexts, navigation, native transport,
  service-worker registration, parser/DOM/prototype routes and storage isolation.
  The new trusted iframe must not reopen those surfaces to application code.
- [ ] Re-run calibrated independent DNS/TCP/STUN observations in Chromium and
  Firefox, with working unrestricted controls and synthetic private markers.
  Missing resources and forged management requests must
  fail without producing external DNS or requests derived from private input.
- [ ] Run the updated build/policy/browser suites, Pitch Training suite, network
  suites and deployed checks. Add focused bridge, URL, generic document import
  and manifest/PWA tests where current suites cannot establish the new properties.
- [ ] Test mobile viewports for installation, permission UI, app launch,
  layout and no unexpected tabs. Check service-worker restart, offline use,
  frame failure and interrupted/failed installation without partial admission.
- [ ] Store new receipts separately from the previous release evidence, including
  browser versions, precise source revisions and supported/unsupported outcomes.

Gate: complete the new requirements with meaningful evidence, not merely renamed
selectors or green old suites. Browser/profile limits must be explicit. A blocked
article dependency or unavailable real-device check is not silently counted as a
successful demonstration.

### 7. Publish on Pages, retire the old runtime and update the report

- [ ] Configure Pages custom domains in GitHub settings/API for the two existing
  public repositories: manager `pf.damenh.com`, runtime `pf-apps.damenh.com`.
  Configure the corresponding DNS CNAMEs to `damenh.github.io` and HTTPS. Custom
  domain settings are authoritative; a generated `CNAME` file alone is insufficient
  for an Actions-based Pages deployment.
- [ ] Replace the old fixture Pages publishing workflow with the runtime workflow.
  Preserve fixture sources and their independent publisher deployments; never
  include their unrestricted HTML/scripts in the trusted runtime Pages artifact.
- [ ] Publish both pinned artifacts, verify HTTPS and the real Pages deployments,
  then run live bridge, app, article, PWA, storage and hostile acceptance checks.
  Audit all delivered asset hashes against the tested artifacts. GitHub's default
  repository URLs should lead to the configured custom domains and must not become
  additional trusted management origins shared with unrelated project pages.
- [ ] Remove the Cloudflare static-asset routes serving manager/runtime after the
  Pages cutover succeeds. Retire the `pf-runtime.damenh.com` domain/route and all
  active configuration/UI references to it. Do not build a legacy bridge,
  compatibility domain or private-data migration mechanism: the user explicitly
  requested retiring it. State that old-origin installations must be reinstalled
  and that existing browser data is not automatically transferred or deleted.
- [ ] Keep a trusted recovery path for manager site-data/service-worker cache
  changes at the same origin so an older cached manager cannot indefinitely pin
  the obsolete connection flow. Do not expose private data during recovery.
- [ ] Update README, report/feature matrix, surface inventory, reproducible test
  commands, GitHub descriptions/homepage links and service inventory. Describe
  the installation-to-confinement boundary, real Pages hosting, manifest
  adaptation and generic document import in plain terms. Keep proposal drafts and Codex
  logs private and outside the two public repositories.
- [ ] Publish the implementation/fixture changes and verify the required CI and
  both Pages deployment runs. Record the actual deployment revisions and final
  requirement audit in a fresh release receipt. Keep rollback information for
  the cutover until live checks succeed; retiring the old domain is the final
  cleanup, not a prerequisite for testing the new site.

Gate: the public manager and individual applications run on their intended custom
domains, served by GitHub Pages. Installation requires no second tab. The old
runtime is retired, source and live assets agree, and the report links to the
actual evidence and remaining limitations.

## Deferred: browser-local recognition sequence

The glyph indicator needs further design and is not implemented or required for
completion of this pass. Preserve the agreed premise for that later discussion:
the sequence would be browser-local and shared across apps; a confined app may
know it or cover its own indicator. The intended boundary is preventing the
sequence from reaching an external page or escaping via network-enabled
installation. Storage, delivery, presentation and the recognition claim remain
design questions. No indicator UI, persistence, protocol or tests are added now.

## Decisions already made for the autonomous pass

No third host origin, extension, backend or runtime request proxy. No additional
repository is required. Publisher fixtures remain separate from trusted sites.
Keep normal JavaScript asynchrony and existing scoped storage support. Do not
replace the architecture with a toy language, rewrite publisher JavaScript to
claim compatibility, or introduce a full membrane for these UI/import changes.

Routine implementation choices and reversible fixes can be resolved during the
pass. If a browser or publisher restriction prevents an agreed outcome, first
investigate within these boundaries and preserve the evidence. Do not solve it by
silently weakening confinement or declaring a narrower outcome complete. Keep
progress updates focused on what was learned and what the next check resolves.

## Technical references checked during planning

- [GitHub Pages custom domains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)
- [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Storage Access API](https://developer.mozilla.org/en-US/docs/Web/API/Storage_Access_API)
- [Manifest identity](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/id)
- [PWA installation requirements](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- [MediaWiki REST API reference](https://www.mediawiki.org/wiki/API:REST_API/Reference/en)

## Implementation progress (2026-10-26)

The iframe bridge, canonical short routes, generic document adaptation and
per-application manifests are implemented. Production-role builds pass the
same-site compatibility checks with browser storage protections restored.
The Wikipedia document and all 60 captured images render offline in both
browsers, with no publisher-specific import code. Chromium installs three native
PWAs, including unchanged Pitch Training; the cold-launch check preserves private
state offline after browser restart. See `results/compatibility.json`.

`test/browser-profile.mjs` restores Chromium partitioning and Firefox cookie
partitioning that automation otherwise disables. The cross-site control observes
separate storage in both browsers (`results/storage-policy.json`). The core,
scoped-storage, bridge, mobile/permission and compatibility suites pass under that
profile. WebKit cannot launch with the host's available libraries; its coverage
is explicitly absent (`results/webkit.json`).

The runtime DNS CNAME points to GitHub Pages, its certificate is approved and
HTTPS enforcement is enabled. The manager is not cut over yet. Pinned runtime
publication, live verification and old-runtime retirement remain unfinished.
