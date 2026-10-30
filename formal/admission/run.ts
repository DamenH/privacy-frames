import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build, type Plugin } from 'esbuild';
import { chromium, firefox } from 'playwright';

const root = resolve(import.meta.dirname, '../..');
const directory = resolve(root, 'formal/admission');
execFileSync('python3', [resolve(directory, 'check.py')], {
  cwd: root,
  stdio: 'inherit',
});
const modelBytes = await readFile(resolve(directory, 'model-results.json'));
const model: unknown = JSON.parse(modelBytes.toString());
assert(model && typeof model === 'object' && 'cases' in model);
assert(model.cases && typeof model.cases === 'object');
const cases = Object.entries(model.cases);
assert.equal(cases.length, 32);

// Mutations are applied only to bundled test sources, never to production files.
const mutations = {
  hash: [['sha256 !== resource.sha256', 'false']],
  path: [['paths.has(path) || urls.has(url)', 'urls.has(url)']],
  url: [['paths.has(path) || urls.has(url)', 'paths.has(path)']],
  pathURL: [['paths.has(path) || urls.has(url)', 'false']],
  pathCanonical: [
    ['paths.has(path) || urls.has(url)', 'urls.has(url)'],
    ['resolvedPaths.has(resolved)', 'false'],
  ],
  pathURLCanonical: [
    ['paths.has(path) || urls.has(url)', 'false'],
    ['resolvedPaths.has(resolved)', 'false'],
  ],
  entry: [
    [
      'const entry = resources.find((resource) => resource.path === manifest.entry);',
      'const entry = resources.find((resource) => resource.path === manifest.entry) || resources[0];',
    ],
  ],
} as const;
type Mutation = keyof typeof mutations;

const input = `
  import { admitInstallation } from './src/runtime/admission.ts';
  import { digest } from './src/shared/policy.ts';
  globalThis.checkAdmission = async function(bits) {
    const source = 'https://publisher.test/index.html';
    const makeResource = async (path, content, contentType) => {
      const bytes = new TextEncoder().encode(content).buffer;
      return {path, url: new URL(path, source).href, bytes, contentType,
        sha256: await digest(bytes)};
    };
    const resources = await Promise.all([
      makeResource('index.html', '<!doctype html><title>Admission</title>', 'text/html'),
      makeResource('asset.txt', 'test resource', 'text/plain'),
    ]);
    if (!bits[0]) resources[0].sha256 = '0'.repeat(64);
    if (!bits[1]) resources[1].sha256 = '0'.repeat(64);
    if (!bits[2]) resources[1].path = resources[0].path;
    if (!bits[3]) resources[1].url = resources[0].url;
    const request = {
      format: 'offline-resources-v1',
      id: 'fixture-' + await digest(new TextEncoder().encode(source)),
      source,
      manifest: {id: 'fixture', name: 'Fixture', entry: bits[4] ? 'index.html' : 'missing.html'},
      resources,
      capture: {additionalResources: [], unavailableResources: []},
    };
    try {
      const result = await admitInstallation(request, new URL('https://runtime.test/'));
      return {decision: 'accepted', resources: result.resources.length};
    } catch (error) {
      return {decision: 'rejected', error: error instanceof Error ? error.message : String(error)};
    }
  };
`;
async function bundle(mutation?: Mutation) {
  const plugins: Plugin[] = [];
  if (mutation) {
    plugins.push({
      name: 'admission-test-mutation',
      setup(builder) {
        builder.onLoad({ filter: /src\/runtime\/admission\.ts$/ }, async (args) => {
          const original = await readFile(args.path, 'utf8');
          let contents = original;
          for (const [needle, replacement] of mutations[mutation]) {
            assert.equal(contents.split(needle).length, 2, 'Mutation anchor changed');
            contents = contents.replace(needle, replacement);
          }
          return { contents, loader: 'ts' };
        });
      },
    });
  }
  const result = await build({
    absWorkingDir: root,
    stdin: { contents: input, resolveDir: root, loader: 'ts' },
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    plugins,
  });
  return result.outputFiles[0].text;
}

const bundles = new Map<string, string>([['safe', await bundle()]]);
for (const mutation of Object.keys(mutations) as Mutation[])
  bundles.set(mutation, await bundle(mutation));
const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const name = url.searchParams.get('bundle') ?? 'safe';
  if (url.pathname === '/fixture.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(bundles.get(name) ?? '');
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<!doctype html><script src="/fixture.js?bundle=' + name + '"></script>',
    );
  }
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const address = server.address();
assert(address && typeof address !== 'string');
const results: object[] = [];
try {
  for (const engine of [chromium, firefox]) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${address.port}/`);
      const observations: object[] = [];
      for (const [key, expected] of cases) {
        assert.equal(typeof expected, 'string');
        assert.match(key, /^[01]{5}$/);
        const result = await page.evaluate(
          (bits) => Reflect.get(globalThis, 'checkAdmission')(bits),
          [...key].map((bit) => bit === '1'),
        );
        assert.equal(result.decision, expected, `${engine.name()}: ${key}`);
        if (result.decision === 'accepted') assert.equal(result.resources, 2);
        observations.push({ bits: key, expected, ...result });
      }
      const faults = [
        ['hash', '01111'],
        ['hash', '10111'],
        ['path', '11011'],
        ['url', '11101'],
        ['pathURL', '11001'],
        ['pathCanonical', '11011'],
        ['pathURLCanonical', '11001'],
        ['entry', '11110'],
      ] as const;
      const faultResults: object[] = [];
      for (const [mutation, key] of faults) {
        await page.goto(`http://127.0.0.1:${address.port}/?bundle=${mutation}`);
        const result = await page.evaluate(
          (bits) => Reflect.get(globalThis, 'checkAdmission')(bits),
          [...key].map((bit) => bit === '1'),
        );
        if (mutation === 'url' || mutation === 'path' || mutation === 'pathURL') {
          // Independent alias/canonical checks still reject these inputs.
          assert.equal(result.decision, 'rejected');
          assert.equal(
            result.error,
            mutation === 'url'
              ? 'Conflicting resource alias'
              : 'Duplicate resolved resource path',
          );
        } else {
          assert.equal(
            result.decision,
            'accepted',
            `${engine.name()}: ${mutation} ${key}`,
          );
        }
        faultResults.push({ mutation, bits: key, ...result });
      }
      results.push({
        browser: engine.name(),
        version: browser.version(),
        observations,
        faultResults,
      });
    } finally {
      await browser.close();
    }
  }
} finally {
  server.closeAllConnections();
  await new Promise<void>((done, fail) =>
    server.close((error) => (error ? fail(error) : done())),
  );
}
const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
await writeFile(
  resolve(directory, 'implementation-results.json'),
  JSON.stringify(
    {
      scope:
        '32 selected malformed-input combinations per browser against actual admitInstallation; test-only mutations exercise omissions and redundant URL and canonical path checks. No commit, browser identity, external network or complete validation proof.',
      modelSHA256: digest(modelBytes),
      runnerSHA256: digest(await readFile(import.meta.filename)),
      sourceSHA256: digest(await readFile(resolve(root, 'src/runtime/admission.ts'))),
      lockfileSHA256: digest(await readFile(resolve(root, 'package-lock.json'))),
      bundleSHA256: Object.fromEntries(
        [...bundles].map(([name, value]) => [
          name,
          digest(new TextEncoder().encode(value)),
        ]),
      ),
      revision: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
      results,
    },
    null,
    2,
  ) + '\n',
);
console.log('Compared 32 admission decisions in Chromium and Firefox');
