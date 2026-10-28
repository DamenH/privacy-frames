import http from 'node:http';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';
import { testProvenance } from './provenance.ts';

import type { IntentProbe } from './fixtures/document-intents/types.ts';

const built = await build({
  entryPoints: ['test/fixtures/document-intents/controller.ts'],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2022',
});
const scoped = await build({
  entryPoints: ['test/fixtures/document-intents/scoped.ts'],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2022',
});
const script = built.outputFiles[0].contents;
const server = http.createServer((request, response) => {
  if (request.url === '/fixture.js' || request.url === '/scope.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(request.url === '/fixture.js' ? script : scoped.outputFiles[0].contents);
    return;
  }
  response.setHeader('Content-Type', 'text/html');
  response.end(
    '<!doctype html><title>Document intent test</title><script src="' +
      (request.url === '/scoped.html' ? '/scope.js' : '/fixture.js') +
      '"></script>',
  );
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Missing fixture address');
const evidence = {
  provenance: await testProvenance(import.meta.url),
  fixtureSHA256: createHash('sha256').update(script).digest('hex'),
  scope:
    'Private real IndexedDB document intents across independent controller connections; no document adapter enabled',
  browsers: [] as { name: string; version: string; result: IntentProbe }[],
};
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    try {
      const page = await browser.newPage();
      await page.goto('http://127.0.0.1:' + address.port + '/');
      const result = await page.evaluate(() => window.runIntentProbe());
      assert(result.checks >= 30);
      assert.equal(result.bindWinners, 1);
      assert.equal(result.consumeWinners, 1);
      assert.equal(result.privateNamespaced, true);
      assert.equal(result.recordPurged, true);
      evidence.browsers.push({ name, version: browser.version(), result });
      console.log(name, JSON.stringify(result));
    } finally {
      await browser.close();
    }
  }
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
await mkdir('results/contexts', { recursive: true });
await writeFile(
  'results/contexts/document-intents.json',
  JSON.stringify(evidence, null, 2) + '\n',
);
