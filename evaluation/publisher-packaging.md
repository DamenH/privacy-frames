# Local publisher snapshot preparation

Four static publishers have been staged under
`/tmp/pf-corpus-publishers/snapshots/`. No deployment repository, GitHub setting,
DNS record or public site was changed. Each staged publisher completes its selected
standalone task in Chromium 153.0.8010.12 and Firefox 155.0. The control receipts
are `results/evaluation/snapshot-*-control.json`.

| Publisher | Source | Captured payload | Licensing |
| --- | --- | ---: | --- |
| Squoosh | Exact deployed files; entry hash matches original corpus | 76 files, 26,022,698 bytes | Apache-2.0 app; GPLv3+ ImageQuant; BSD/MIT/Apache codec notices |
| Excalidraw | Exact deployed files; entry hash matches original corpus | 510 files, 23,141,204 bytes | MIT app; upstream notices retained; external CDN fonts are referenced rather than redistributed |
| StackEdit | Exact deployed files; entry hash matches original corpus | 127 files, 7,642,973 bytes | Apache-2.0 app; bundled dependency and font notices must accompany redistribution |
| diagrams.net | Official draw.io v32.6.1 `draw.war` static files | 3,065 files, 112,387,927 bytes | Apache-2.0 code, retained icon/stencil restrictions, CC-BY-4.0 templates |

The URL, size and SHA256 of each captured file are retained in
[`results/evaluation/publishers/`](../results/evaluation/publishers/).
Snapshot discovery scans literal resource references; its unavailable-reference
list includes source-code strings that are not real requests. The standalone
controls verify the chosen tasks against the staged files, rather than treating
successful downloads as proof that the apps start. The snapshots are not a claim
that every optional app feature or codec has been exercised.

## Origins and paths

The existing `privacy-frames-apps` repository is a trusted runtime publisher at
`pf-apps.damenh.com`. Its `AGENTS.md` allows only pinned `dist-runtime` output.
Putting unrestricted applications beside that output would give publisher code
access to the trusted runtime origin.

A separate publisher Pages site is needed. Renaming the current deployment
repository to `runtime` and creating an `apps` repository in the `privacy-frames`
organization would express these roles directly. Each repository can keep one
Pages site and custom domain. Host implementation, experiments and documentation
can remain in `main`.

Squoosh, Excalidraw and StackEdit use root-relative paths. Publishing them at
`/squoosh/`, `/excalidraw/` and `/stackedit/` on one site therefore needs a recorded
base-path relocation, or separate publisher origins. That relocation belongs to
the publisher packaging, with before/after hashes and notices of modified files.
The host importer should receive the ordinary URLs and resources produced by that
site. draw.io's release largely uses relative static paths and already works from
its extracted static root.

## Squoosh corresponding source

The deployed `imagequant-a10bbe1a.wasm` is GPLv3-or-later. Its SHA256 is
`92ae97683f196cbbc634a37117de3cd16218985e8356d4218524aefe5509d355`.
It exactly matches `codecs/imagequant/imagequant.wasm` in Squoosh commit
`e8d35e0fb66eb16eff6fe8fc773eabcbb7128de3`. That commit contains the wrapper source
and Makefile; its README and Makefile identify libimagequant 2.12.1.

The full pinned Squoosh source archive and libimagequant 2.12.1 source archive are
staged in `/tmp/pf-corpus-publishers/source-archives/`. Their sizes and SHA256 values
are recorded in [`sources.json`](../results/evaluation/publishers/sources.json).
The source archives and build scripts should be distributed alongside the binary
mirror, with links from its license notice. All six codec license files were also
staged under the Squoosh snapshot's `UPSTREAM-NOTICES/` directory.

The draw.io archive is 48,958,551 bytes with SHA256
`44dd56958c8408963457dc98f04d2228408ac145c7aa1d8e6895d9c88d5e42aa`.
Extraction omitted Java server directories and JSP/Java/class files; static files
are unchanged. The complete static payload exceeds the host's 100 MiB admission
limit, but the application may require a smaller resource graph for the selected
task. That question belongs in the installation experiment.

## License sources

The upstream licenses are
[Squoosh](https://github.com/GoogleChromeLabs/squoosh/blob/e8d35e0fb66eb16eff6fe8fc773eabcbb7128de3/LICENSE),
[ImageQuant integration](https://github.com/GoogleChromeLabs/squoosh/blob/e8d35e0fb66eb16eff6fe8fc773eabcbb7128de3/codecs/imagequant/LICENSE.codec.md),
[Excalidraw](https://github.com/excalidraw/excalidraw/blob/master/LICENSE),
[StackEdit](https://github.com/benweet/stackedit/blob/master/LICENSE), and
[draw.io](https://github.com/jgraph/drawio/blob/v32.6.1/LICENSE).
The extracted draw.io archive also retains `img/LICENSE`, `shapes/LICENSE`,
`stencils/LICENSE` and `templates/LICENSE`. Its icon/stencil notices restrict use
in the Atlassian ecosystem; this evaluation publisher is outside that ecosystem.
