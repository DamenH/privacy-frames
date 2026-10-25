# Single origin host and GitHub Pages migration

- [x] Compact dark interface: URL, Install, app list, Open/Remove, example links and optional diagnostics/report.
- [x] One static host origin with direct authenticated management, no iframe bridge and no separate runtime deployment.
- [x] Test protection of host data, worker management and manager windows on the shared origin; retain context/network/compatibility/failure tests.
- [x] Host source in DamenH/privacy-frames; independent applications in DamenH/privacy-frames-apps, on a distinct publisher origin.
- [ ] GitHub Pages builds and deployed tests; update existing share link without rotation.
- [x] Accurate report, evidence and reproduction instructions.

The earlier package-only installation convention remains in this implementation. Network-enabled explicit installation callbacks are a separate discussed direction, not silently added to this UI/deployment migration.

Current share checks pass in both browsers, including offline launch and the editable playground. GitHub repositories are public with owner approval. Publisher Pages deployment succeeded; host Pages workflow is running. The publisher DNS record is not yet present and the configured token returns DNS 403.
