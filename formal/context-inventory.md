# Native worker-context inventory

Run `node formal/context-inventory.ts` to enumerate an unrestricted loopback
page's dedicated worker, shared worker and native service worker in Chromium
and Firefox. It saves [context-features.json](evidence/context-features.json)
with browser versions and the runner hash. It uses the default Playwright profile
and reads each context's `navigator` reference. It inspects property descriptors
and names without invoking arbitrary member getters.

Run `python3 formal/context-join.py` to join the saved observations to the
[bounded IDL report](idl-surface-report.md), or add `--check` to verify the saved
[context-idl-join.json](evidence/context-idl-join.json). The join retains the
original 263 rows; it does not expand the set of specifications. In this
snapshot, 56 rows that were not observed in the earlier window and dedicated
worker snapshot have a matching name in at least one newly captured context.
These include native service-worker client and background-event interfaces.
The earlier snapshot used the repository's adjusted browser profile; this one
uses Playwright defaults, so that comparison is not solely a context experiment.

The native contexts are not the installed application's prepared contexts.
An observed constructor or property name does not establish that an application
can acquire, call or use an object, or that it can cause a network effect. An
unobserved name does not establish absence. The join does not fully resolve IDL
exposure or mixins and does not cover worklets, browser-generated effects, other
browser versions or flags. Follow the [route review](route-review/README.md) and
[claim ledger](claims/README.md) for security dispositions and receiver evidence.

CI checks the committed join against its inputs. The browser job also regenerates
and uploads a fresh snapshot and join; it does not require a newer browser to
match the historical property names.
