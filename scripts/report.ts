import { marked } from 'marked';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const output = process.env.BUILD_DIRECTORY
  ? pathToFileURL(resolve(process.env.BUILD_DIRECTORY) + '/')
  : new URL('../dist-manager/', import.meta.url);
const source = await readFile(new URL('../REPORT.md', import.meta.url), 'utf8');
const configuration: unknown = JSON.parse(
  await readFile(new URL('config.json', output), 'utf8'),
);
const managerURL =
  configuration &&
  typeof configuration === 'object' &&
  'managerURL' in configuration &&
  typeof configuration.managerURL === 'string'
    ? new URL(configuration.managerURL).href
    : 'https://pf.damenh.com/';
const escapeAttribute = (value: string) =>
  value.replace(/[&"<>]/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '"': '&quot;',
      '<': '&lt;',
      '>': '&gt;',
    };
    return entities[character];
  });

// This document has its own small stylesheet so Tailwind's application reset
// cannot remove Markdown heading sizes, paragraph spacing or list markers.
const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <title>Privacy Frames — Report</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-synthesis: none;
      background: #111316;
      color: #cbd1da;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-size: 1rem; line-height: 1.75; }
    header, main { width: min(100% - 2.5rem, 49rem); margin-inline: auto; }
    header { padding-top: 1.5rem; }
    main { padding-block: 1rem 4rem; overflow-wrap: anywhere; }
    a { color: #b9d2ff; text-underline-offset: 0.2em; }
    a:hover { color: #e1ecff; }
    a:focus-visible { outline: 2px solid currentColor; outline-offset: 4px; }
    h1, h2, h3 { color: #edf0f4; font-weight: 650; line-height: 1.25; }
    h1 { margin: 0.75rem 0 1.5rem; font-size: clamp(1.75rem, 4vw, 2.25rem); }
    h2 { margin: 2.25rem 0 0.85rem; font-size: 1.3rem; }
    h3 { margin: 1.5rem 0 0.75rem; font-size: 1.1rem; }
    p, ul, ol, pre, table { margin-block: 0 1.15rem; }
    ul, ol { padding-left: 1.5rem; }
    li + li { margin-top: 0.35rem; }
    code { padding: 0.1em 0.3em; border-radius: 0.2rem; background: #242a33; font-size: 0.9em; }
    pre { overflow-x: auto; padding: 1rem; border-radius: 0.35rem; background: #1a1e25; }
    pre code { padding: 0; background: transparent; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #353c47; padding: 0.5rem; text-align: left; }
    blockquote { margin-inline: 0; padding-left: 1rem; border-left: 2px solid #526075; }
    @media print {
      :root { color-scheme: light; background: white; color: black; }
      header { display: none; }
      h1, h2, h3, a { color: black; }
      main { width: 100%; padding: 0; }
      code, pre { background: #eeeeee; }
      h2, h3 { break-after: avoid; }
    }
  </style>
</head>
<body>
  <header><a href="${escapeAttribute(managerURL)}">← Library</a></header>
  <main>${await marked.parse(source)}</main>
</body>
</html>
`;

await writeFile(new URL('report.html', output), html);
