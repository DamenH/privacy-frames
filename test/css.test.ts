import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { cssReferences, prepareCSS } from '../src/installation/css.ts';
import { prepareDocument } from '../src/installation/document.ts';
import { downloadWebsite } from '../src/installation/import-website.ts';

const base = 'https://publisher.test/css/main.css';

test('CSS resource syntax excludes comments, content strings, selectors and conditions', () => {
  const css = `/* url(comment.png) @import "comment.css"; */
@namespace url(namespace.xml);
@supports (background: url(condition.png)) {
  [data-value="url(selector.png)"]::before {
    content: "url(content.png) @import 'text.css'";
    background: url(real.png);
  }
}`;
  const prepared = prepareCSS(css, base);
  assert.deepEqual(prepared.urls, ['https://publisher.test/css/real.png']);
  assert.equal(
    prepared.text,
    css.replace('url(real.png)', 'url("https://publisher.test/css/real.png")'),
  );
});

test('imports, escaped URLs, nested values and custom properties share extraction and relocation', () => {
  const css = String.raw`@\69mport "theme\20 one.css" layer(base) supports(background: url(condition.png));
@import url(other.css) screen;
.a { background: image-set(url("im\61 ge.png") 1x, url(two.png) 2x); --image: url(custom.png); mask: url(#local); other: url(data:image/png,x); }`;
  const expected = [
    'https://publisher.test/css/theme%20one.css',
    'https://publisher.test/css/other.css',
    'https://publisher.test/css/image.png',
    'https://publisher.test/css/two.png',
    'https://publisher.test/css/custom.png',
  ];
  const prepared = prepareCSS(css, base);
  assert.deepEqual(prepared.urls, expected);
  assert.deepEqual(cssReferences(prepared.text, base), expected);
  assert(prepared.text.includes('supports(background: url(condition.png))'));
  assert(prepared.text.includes('mask: url(#local)'));
  assert(prepared.text.includes('other: url(data:image/png,x)'));
  assert.deepEqual(
    cssReferences(String.raw`a { background: u\72l("image.png") }`, base),
    ['https://publisher.test/css/image.png'],
  );
});

test('malformed declarations preserve later valid CSS resources', () => {
  const css = 'a{color:???;background:url(bad".png);border-image:url(real.png)}';
  assert.deepEqual(cssReferences(css, base), ['https://publisher.test/css/real.png']);
  assert.equal(
    prepareCSS(css, base).text,
    css.replace('url(real.png)', 'url("https://publisher.test/css/real.png")'),
  );
});

test('style attributes use declaration context while style blocks preserve quoted text', () => {
  const document = prepareDocument(
    `<base href="/css/"><style>/* url(comment.png) */p{content:'url(text.png)';background:url(block.png)}</style><p style="content:'url(attribute-text.png)';background:url(attribute.png)">`,
    'https://publisher.test/',
  );
  assert.deepEqual(document.links, [
    'https://publisher.test/css/block.png',
    'https://publisher.test/css/attribute.png',
  ]);
  assert(document.html.includes('/* url(comment.png) */'));
  assert(document.html.includes("content:'url(text.png)'"));
  assert(document.html.includes("content:'url(attribute-text.png)'"));
  assert(document.html.includes('https://publisher.test/css/block.png'));
  assert(document.html.includes('https://publisher.test/css/attribute.png'));
});

test('installation requests only parsed CSS resource declarations', async () => {
  const requests: string[] = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url || '/');
    if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><link rel="stylesheet" href="/main.css">');
    } else if (request.url === '/main.css') {
      response.setHeader('Content-Type', 'text/css');
      response.end(
        '/*url(comment.png)*/ @import "theme.css";@supports(background:url(condition.png)){p{content:"url(text.png)";background:url(real.png)}}',
      );
    } else if (request.url === '/theme.css') {
      response.setHeader('Content-Type', 'text/css');
      response.end('p{color:red}');
    } else if (request.url === '/real.png') {
      response.setHeader('Content-Type', 'image/png');
      response.end('image fixture');
    } else response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  try {
    const app = await downloadWebsite({ url: `http://127.0.0.1:${address.port}/` });
    assert.deepEqual(requests.sort(), ['/', '/main.css', '/real.png', '/theme.css']);
    assert.equal(app.resources.length, 4);
    assert.deepEqual(app.capture.unavailableResources, []);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
