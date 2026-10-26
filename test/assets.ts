import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url),
  sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const evidence = { date: new Date().toISOString(), assets: [] };
async function filesUnder(directory, prefix = '') {
  const paths = [];
  for (const item of await readdir(new URL(prefix, directory), { withFileTypes: true })) {
    const path = prefix + item.name;
    if (item.isDirectory()) paths.push(...(await filesUnder(directory, path + '/')));
    else if (item.isFile()) paths.push(path);
  }
  return paths;
}

for (const [site, base, directory] of [
  ['manager', 'https://pf.damenh.com/', 'dist-manager'],
  ['runtime', 'https://pf-apps.damenh.com/', 'dist-runtime'],
]) {
  for (const file of (await filesUnder(new URL(directory + '/', root))).filter(
    (file) => !file.startsWith('.'),
  )) {
    const response = await fetch(new URL(file, base), {
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get('server') || '',
      /github/i,
      'Trusted sites must be served by GitHub Pages',
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(
      sha(bytes),
      sha(await readFile(new URL(directory + '/' + file, root))),
      site + '/' + file,
    );
    evidence.assets.push({ site, file, sha256: sha(bytes) });
  }
  const missing = await fetch(new URL('AAAAAAAAAAA/not-installed/', base));
  assert.equal(missing.status, 404, 'Static fallback admitted an uncontrolled app');
  for (const path of [
    'notes/index.html',
    'adversary/index.html',
    'ordinary/index.html',
  ]) {
    const response = await fetch(new URL(path, base), { cache: 'no-store' });
    assert.equal(
      response.status,
      404,
      'Publisher code must not be served on the trusted ' + site + ' origin',
    );
  }
}
for (const id of ['notes', 'image', 'adversary', 'playground', 'ordinary']) {
  const base =
    id === 'playground'
      ? 'https://pf-adversary.damenh.com/playground/'
      : `https://pf-${id}.damenh.com/`;
  const directory = new URL('dist-examples/' + id + '/', root);
  for (const file of (await filesUnder(directory)).filter(
    (file) => !['_headers', '_redirects'].includes(file.split('/').at(-1)),
  )) {
    const response = await fetch(new URL(file, base), {
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(
      sha(bytes),
      sha(await readFile(new URL(file, directory))),
      id + '/' + file,
    );
    evidence.assets.push({ site: id, file, sha256: sha(bytes) });
  }
}
const github = await fetch('https://damenh.github.io/privacy-frames/config.json');
assert.equal(github.status, 200);
const config = await github.json();
assert.equal(config.managerURL, 'https://pf.damenh.com/');
assert.deepEqual(config.managerOrigins, ['https://pf.damenh.com']);
evidence.githubEntry = { managerURL: config.managerURL, runtimeURL: config.runtimeURL };
await writeFile(
  new URL('results/assets.json', root),
  JSON.stringify(evidence, null, 2) + '\n',
);
console.log(
  evidence.assets.length,
  'published assets match release source files; uncontrolled paths return 404.',
);
