import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { chromium, firefox } from 'playwright';
import { trustedPolicyPlugin } from '../../scripts/trusted-policy.ts';
import { response } from '../../src/runtime/response-policy.ts';

const root = resolve(import.meta.dirname, '../..');
const receiptPath = resolve(import.meta.dirname, 'initialization-result.json');
await rm(receiptPath, { force: true });
const received: string[] = [];
const bundles = new Map<string, Uint8Array>();
let origin = '';
const server = http.createServer((request, reply) => {
  const path = request.url || '/';
  reply.setHeader('Cache-Control', 'no-store');
  if (path.startsWith('/receive?')) {
    received.push(path);
    reply.setHeader('Content-Type', 'text/html');
    reply.end('<!doctype html><title>Receiver</title>');
    return;
  }
  const bundle = bundles.get(path);
  if (bundle) {
    reply.setHeader('Content-Type', 'text/javascript');
    reply.end(bundle);
  } else {
    for (const [key, value] of response('', 'text/html', 200, { scriptNonce: 'fixture' })
      .headers)
      reply.setHeader(key, value);
    const profile = path.slice(1).split('/')[0];
    reply.end(
      `<!doctype html><body><script nonce="fixture" src="/${profile}.js"></script>`,
    );
  }
});
await new Promise<void>((done, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', done);
});
const address = server.address();
assert(address && typeof address !== 'string');
origin = `http://127.0.0.1:${address.port}`;
const probe = `
const token = crypto.randomUUID();
console.log('module-token:' + token);
navigation.addEventListener('navigate', event => console.log('module-event:' + JSON.stringify({
  trusted:event.isTrusted, cancelable:event.cancelable, prevented:event.defaultPrevented,
  sameDocument:event.destination.sameDocument, navigationType:event.navigationType
})));
const link = document.createElement('a');
link.href = ${JSON.stringify(origin + '/receive?token=')} + token;
document.body.append(link);
link.click();
throw new Error('Test stops after the initialization probe');
`;
bundles.set('/native.js', Buffer.from(probe));
const sourceHashes: Record<string, string> = {};
const hash = (value: Uint8Array | string) =>
  createHash('sha256').update(value).digest('hex');
for (const profile of ['normal', 'altered']) {
  let injections = 0,
    removals = 0;
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['src/runtime/guard.ts'],
    bundle: true,
    write: false,
    target: 'es2022',
    format: 'iife',
    banner: { js: '"use strict";' },
    plugins: [
      await trustedPolicyPlugin(root),
      {
        name: 'test-module-initialization-order',
        setup(builder) {
          builder.onLoad(
            { filter: /[/\\]runtime[/\\]root-guard\.ts$/ },
            async ({ path }) => {
              const source = await readFile(path, 'utf8');
              sourceHashes['src/runtime/root-guard.ts'] = hash(source);
              injections++;
              return { contents: probe + source, loader: 'ts' };
            },
          );
          if (profile === 'altered')
            builder.onLoad(
              { filter: /[/\\]enforcement[/\\]document-exit\.ts$/ },
              async ({ path }) => {
                const source = await readFile(path, 'utf8');
                const action = 'apply(prevent, event, []);';
                assert.equal(source.split(action).length, 2);
                removals++;
                return { contents: source.replace(action, 'void event;'), loader: 'ts' };
              },
            );
        },
      },
    ],
  });
  assert.equal(injections, 1);
  assert.equal(removals, profile === 'altered' ? 1 : 0);
  bundles.set('/' + profile + '.js', result.outputFiles[0].contents);
}
for (const path of [
  'src/runtime/guard.ts',
  'src/runtime/enforcement/document-exit.ts',
  'package-lock.json',
])
  sourceHashes[path] = hash(await readFile(resolve(root, path)));
const browsers = [];
try {
  for (const engine of [chromium, firefox]) {
    const browser = await engine.launch();
    try {
      const cases = [];
      for (const profile of ['native', 'normal', 'altered']) {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          let token: string | undefined;
          const events: unknown[] = [];
          page.on('console', (message) => {
            if (message.text().startsWith('module-token:'))
              token = message.text().slice('module-token:'.length);
            if (message.text().startsWith('module-event:'))
              events.push(JSON.parse(message.text().slice('module-event:'.length)));
          });
          await page.goto(origin + '/' + profile + '/', { waitUntil: 'commit' });
          await page.waitForTimeout(800);
          assert(token, 'Probe must execute during heavy module initialization');
          const observedToken = token;
          const requests = received.filter((path) => path.includes(observedToken));
          assert.equal(requests.length, profile === 'normal' ? 0 : 1);
          assert.deepEqual(events, [
            {
              trusted: true,
              cancelable: true,
              prevented: profile === 'normal',
              sameDocument: false,
              navigationType: 'push',
            },
          ]);
          cases.push({ profile, token, requests, events, after: page.url() });
          console.log(
            `${engine.name()} ${profile}: initialization receiver requests ${requests.length}`,
          );
        } finally {
          await context.close();
        }
      }
      browsers.push({ name: engine.name(), version: browser.version(), cases });
    } finally {
      await browser.close();
    }
  }
  await writeFile(
    receiptPath,
    JSON.stringify(
      {
        scope:
          'Actual root entry with a test-only heavy-module initialization probe and an independent HTTP receiver. The probe stops before root startup; this is not installed-app or all-module-behavior coverage.',
        runnerSHA256: hash(await readFile(import.meta.filename)),
        sourceHashes,
        bundles: Object.fromEntries(
          [...bundles].map(([name, bytes]) => [name, hash(bytes)]),
        ),
        browsers,
        completed: true,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
}
