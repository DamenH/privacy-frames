import test from 'node:test';
import assert from 'node:assert/strict';
import { finiteResources } from '../src/installation/finite-resources.ts';
import { downloadWebsite } from '../src/installation/import-website.ts';

const context = {
  realm: 'window' as const,
  sourceURL: 'https://publisher.test/tool/assets/main.js',
  baseURL: 'https://publisher.test/tool/',
  documentURL: 'https://publisher.test/tool/',
};
function workerCode(field: string, directory: string, names: string[]) {
  const table = Object.fromEntries(
    names.map((value, index) => [index, { [field]: value }]),
  );
  return `const metadata=JSON.parse(${JSON.stringify(JSON.stringify(table))});
    function load(option){const chosen=metadata[option].${field};importScripts(\`\${runtime.base}/${directory}/\${chosen}.js\`);}`;
}
function bundledWorker(code: string) {
  return `workerFactory(${JSON.stringify(code)},'Worker',undefined,undefined);`;
}

test('declared worker code uses finite static data fields with explicit directory diagnostics', () => {
  for (const [field, directory] of [
    ['bucket', 'plugins'],
    ['family', 'engines'],
  ]) {
    const result = finiteResources(
      bundledWorker(workerCode(field, directory, ['Alpha', 'Beta'])),
      context,
    );
    assert.deepEqual(result.references.map((entry) => entry.url).sort(), [
      `https://publisher.test/tool/${directory}/Alpha.js`,
      `https://publisher.test/tool/${directory}/Beta.js`,
    ]);
    assert.equal(result.directoryAssumptions, 1);
    assert.match(result.assumptions[0].reason, /Conservative capture assumes/);
  }
});

test('quoted snippets, comments and dynamic metadata are not executed or collected as worker code', () => {
  const snippets = [
    `const documentation=${JSON.stringify(workerCode('bucket', 'plugins', ['Alpha']))};`,
    `// importScripts('comment.js')`,
    `workerFactory(computeCode(),'Worker');`,
    bundledWorker(
      `const data=JSON.parse(readMetadata());function load(option){const selected=data[option].bucket;importScripts(\`\${runtime.base}/plugins/\${selected}.js\`);}`,
    ),
    bundledWorker(`const data=JSON.parse('globalThis.__finiteExecuted=true');`),
  ];
  for (const source of snippets)
    assert.deepEqual(finiteResources(source, context).references, []);
  assert.equal(Reflect.get(globalThis, '__finiteExecuted'), undefined);
});

test('large field sets are declined rather than causing unbounded resource guesses', () => {
  const source = bundledWorker(
    workerCode(
      'bucket',
      'plugins',
      Array.from({ length: 129 }, (_, index) => 'Plugin' + index),
    ),
  );
  assert.deepEqual(finiteResources(source, context).references, []);
});

test('resource capture admits inferred resources without executing the application or worker', async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  const script = bundledWorker(workerCode('family', 'engines', ['Alpha', 'Beta']));
  try {
    globalThis.fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === 'https://publisher.test/tool/')
        return new Response(
          '<!doctype html><title>Finite loader fixture</title><script src="assets/main.js"></script>',
          { headers: { 'Content-Type': 'text/html' } },
        );
      if (url === context.sourceURL)
        return new Response(script, { headers: { 'Content-Type': 'text/javascript' } });
      if (/\/engines\/(Alpha|Beta)\.js$/.test(url))
        return new Response('globalThis.__finiteExecuted=true', {
          headers: { 'Content-Type': 'text/javascript' },
        });
      return new Response('Missing', { status: 404 });
    };
    const app = await downloadWebsite('https://publisher.test/tool/');
    assert(
      app.resources.some(
        (resource) => resource.url === 'https://publisher.test/tool/engines/Alpha.js',
      ),
    );
    assert(
      app.resources.some(
        (resource) => resource.url === 'https://publisher.test/tool/engines/Beta.js',
      ),
    );
    assert.equal(Reflect.get(globalThis, '__finiteExecuted'), undefined);
    assert(requests.includes('https://publisher.test/tool/engines/Alpha.js'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
