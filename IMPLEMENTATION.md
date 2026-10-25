# Single origin host and GitHub Pages migration

- [x] Compact dark interface: URL, Install, app list, Open/Remove, example links and optional diagnostics/report.
- [x] One static host origin with direct authenticated management, no iframe bridge and no separate runtime deployment.
- [x] Test protection of host data, worker management and manager windows on the shared origin; retain context/network/compatibility/failure tests.
- [x] Host source in DamenH/privacy-frames; independent applications in DamenH/privacy-frames-apps, on a distinct publisher origin.
- [x] GitHub Pages builds and deployed tests; update existing share link without rotation.
- [x] Accurate report, evidence and reproduction instructions.

The earlier package-only installation convention remains in this implementation. Network-enabled explicit installation callbacks are a separate discussed direction, not silently added to this UI/deployment migration.

The source repositories are public with owner approval. Both GitHub Pages and the unchanged share URL pass fresh-browser installation, native interaction, sandbox and offline-launch checks. Raw GitHub resources provide the external installation origin. The additional pf-apps.damenh.com alias awaits DNS permission and is not a dependency of the working host.
