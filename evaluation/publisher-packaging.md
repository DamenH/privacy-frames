# Publisher copies

The unrestricted application site is
[privacy-frames.github.io/apps](https://privacy-frames.github.io/apps/), published
from [privacy-frames/apps](https://github.com/privacy-frames/apps) on GitHub Pages.
The manager remains at `pf.damenh.com` and the trusted runtime at
`apps.pf.damenh.com`. Publisher code is never served on either trusted origin.

The apps repository owns maintained examples, licensed upstream mirrors and links
to externally hosted applications. Host tests obtain the maintained examples from
a pinned apps checkout. Mirrored binaries are SHA-pinned GitHub release archives;
the Git repository contains their inventories, licensing information, build code
and locks. The Pages workflow verifies archive hashes before extraction, builds
the examples and relocates resource URLs into `/apps/<name>/`.

| Mirror | Upstream input | Static snapshot | Licensing |
| --- | --- | ---: | --- |
| Squoosh | Deployed files, entry hash matches original corpus | 76 files, 26,022,698 bytes | Apache-2.0 app; GPLv3+ ImageQuant; retained codec notices |
| Excalidraw | Deployed files, entry hash matches original corpus | 510 files, 23,141,204 bytes | MIT app; external CDN fonts referenced |
| StackEdit | Deployed files, entry hash matches original corpus | 127 files, 7,642,973 bytes | Apache-2.0 app; bundled and font notices retained |
| diagrams.net | Official draw.io v32.6.1 `draw.war` | 3,065 files, 112,387,927 bytes | Apache-2.0 code; retained icon/stencil restrictions; CC-BY-4.0 templates |

The [capture inventories](../results/evaluation/publishers/) record original URLs,
file sizes and SHA256 values. Snapshot discovery scans literal references; some
unavailable references are source-code strings rather than actual requests. Each
raw snapshot and relocated Pages copy completes its chosen standalone task in
Chromium and Firefox. Optional app features and every codec were not exercised.

## Relocation

The build rewrites known root-relative resource paths in JavaScript string tokens,
HTML attributes, CSS and JSON. It preserves relative references and string values
used as path-join suffixes. The Webpack public path receives the mirror prefix;
Squoosh's `/editor` route is declared explicitly. Each changed file has a
modification notice and before/after hashes in `MODIFICATIONS.json`.

The draw.io release uses relative paths for most resources. Its Java server
directories and JSP/Java/class files are omitted from the static copy. Its complete
static payload exceeds the host's 100 MiB admission limit; successful installation
of the selected resource graph does not imply that every asset was captured.

## Corresponding source and notices

Squoosh's deployed `imagequant-a10bbe1a.wasm` has SHA256
`92ae97683f196cbbc634a37117de3cd16218985e8356d4218524aefe5509d355`.
Those bytes match `codecs/imagequant/imagequant.wasm` at Squoosh commit
`e8d35e0fb66eb16eff6fe8fc773eabcbb7128de3`. Its wrapper source, README and Makefile
identify libimagequant 2.12.1 and the integration build. The matching source
archives are distributed through the publisher's `sources/` directory and the
[pinned release](https://github.com/privacy-frames/apps/releases/tag/snapshots-2026-10-27).
Their hashes are recorded in [sources.json](../results/evaluation/publishers/sources.json).
The binary mirror retains all six codec license files under `UPSTREAM-NOTICES/`.

The upstream licenses are
[Squoosh](https://github.com/GoogleChromeLabs/squoosh/blob/e8d35e0fb66eb16eff6fe8fc773eabcbb7128de3/LICENSE),
[ImageQuant integration](https://github.com/GoogleChromeLabs/squoosh/blob/e8d35e0fb66eb16eff6fe8fc773eabcbb7128de3/codecs/imagequant/LICENSE.codec.md),
[Excalidraw](https://github.com/excalidraw/excalidraw/blob/master/LICENSE),
[StackEdit](https://github.com/benweet/stackedit/blob/master/LICENSE) and
[draw.io](https://github.com/jgraph/drawio/blob/v32.6.1/LICENSE).
The draw.io archive retains `img/LICENSE`, `shapes/LICENSE`, `stencils/LICENSE` and
`templates/LICENSE`. Its icon/stencil notices restrict use in the Atlassian
ecosystem; this evaluation publisher is outside that ecosystem.
