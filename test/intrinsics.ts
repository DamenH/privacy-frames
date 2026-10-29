import http from 'node:http';
import assert from 'node:assert/strict';
import { build } from './build.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';
import { testProvenance } from './provenance.ts';
import type {} from './fixtures/intrinsics/guarded.ts';
const fixture = await build({
  entryPoints: ['test/fixtures/intrinsics/guarded.ts'],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2022',
  banner: { js: '"use strict";' },
});
const server = http.createServer((request, response) => {
  if (request.url === '/fixture.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(fixture.outputFiles[0].contents);
    return;
  }
  response.setHeader('Content-Type', 'text/html');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'none';script-src 'self' 'unsafe-eval'",
  );
  response.end(
    '<!doctype html><title>Intrinsic compatibility</title><script src="/fixture.js"></script>',
  );
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Fixture address missing');
const evidence = {
  provenance: await testProvenance(import.meta.url),
  browsers: [] as unknown[],
};
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    try {
      const page = await browser.newPage();
      await page.goto('http://127.0.0.1:' + address.port + '/');
      const structured = await page.evaluate(() => ({
        kind: 'structured-result',
        timestamp: new Date(0).toISOString(),
        nested: { value: 3 },
      }));
      assert.deepEqual(structured, {
        kind: 'structured-result',
        timestamp: '1970-01-01T00:00:00.000Z',
        nested: { value: 3 },
      });
      const result = await page.evaluate(() => window.runIntrinsicsProbe());
      assert(result.checks > 300);
      assert(result.shadowedMethods >= 20);
      assert.equal(result.observedReceivers, 0);
      evidence.browsers.push({ name, version: browser.version(), result });
      console.log(name, JSON.stringify(result));
    } finally {
      await browser.close();
    }
  }
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mkdir('results/contexts', { recursive: true });
  await writeFile(
    'results/contexts/intrinsics.json',
    JSON.stringify(evidence, null, 2) + '\n',
  );
}
