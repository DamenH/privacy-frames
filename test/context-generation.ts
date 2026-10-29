import http from 'node:http';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from './build.ts';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';
import { testProvenance } from './provenance.ts';

interface GenerationProbe {
  sameInstalledAt: boolean;
  publisherClaimIgnored: boolean;
  firstGeneration: string;
  replacementGeneration: string;
  generations: string[];
  overlap: { read: 'old-generation' | 'rejected'; staleReadRejected: boolean }[];
}
declare global {
  interface Window {
    runGenerationProbe(): Promise<GenerationProbe>;
  }
}

const fixture = await build({
  stdin: {
    resolveDir: process.cwd(),
    sourcefile: 'context-generation-fixture.js',
    contents: `
import { getApp, getResource, putApp } from './src/runtime/storage.ts';
const id = 'storage-generation-fixture';
const path = 'resource.txt';
const installedAt = '2026-10-27T12:00:00.000Z';
const encode = value => new TextEncoder().encode(value).buffer;
const text = value => new TextDecoder().decode(value);
const check = (condition, message) => { if (!condition) throw new Error(message); };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const app = value => ({
  id,
  generation: 'publisher-picked-generation',
  manifest: { id: 'fixture', name: 'Fixture', entry: path },
  source: 'https://publisher.invalid/',
  resources: [{ path, url: 'https://publisher.invalid/resource.txt', contentType: 'text/plain', sha256: 'fixture', bytes: encode(value) }],
  size: value.length,
  installedAt,
  format: 'offline-resources-v1', capture: { additionalResources: [], unavailableResources: [] },
});
window.runGenerationProbe = async () => {
  await putApp(app('initial bytes'));
  const first = await getApp(id);
  check(uuid(first.generation), 'First generation must be a host UUID');
  check(first.generation !== 'publisher-picked-generation', 'Downloaded generation was trusted');
  check(text(await getResource(id, path, first.generation)) === 'initial bytes', 'Initial checked read failed');
  for (const missing of [undefined, '']) {
    let rejected = false;
    try { await getResource(id, path, missing); } catch { rejected = true; }
    check(rejected, 'Missing generation reached an unversioned resource read');
  }
  await putApp(app('replacement bytes'));
  const second = await getApp(id);
  check(uuid(second.generation) && first.generation !== second.generation, 'Replacement must mint a new UUID');
  check(first.installedAt === second.installedAt, 'Fixture timestamps must remain identical');
  let staleRejected = false;
  try { await getResource(id, path, first.generation); } catch { staleRejected = true; }
  check(staleRejected, 'Old generation read replacement graph');
  check(text(await getResource(id, path, second.generation)) === 'replacement bytes', 'Current generation cannot read replacement');

  const generations = [first.generation, second.generation];
  const overlap = [];
  let current = second;
  let currentBytes = 'replacement bytes';
  for (let index = 0; index < 12; index++) {
    const old = current;
    const oldBytes = currentBytes;
    const newBytes = 'iteration ' + index + ' replacement bytes';
    const checkedRead = async () => {
      try { return { bytes: text(await getResource(id, path, old.generation)) }; }
      catch { return { rejected: true }; }
    };
    // Alternate scheduling order while both operations open independent native
    // connections. A snapshot may read old bytes or reject; it must never pair
    // old metadata with replacement bytes.
    let read, replacement;
    if (index % 2) { replacement = putApp(app(newBytes)); read = checkedRead(); }
    else { read = checkedRead(); replacement = putApp(app(newBytes)); }
    const observed = await read;
    await replacement;
    check(observed.rejected || observed.bytes === oldBytes, 'Old generation observed replacement bytes during overlap');
    current = await getApp(id);
    currentBytes = newBytes;
    check(uuid(current.generation) && !generations.includes(current.generation), 'Stored generation was reused');
    generations.push(current.generation);
    check(text(await getResource(id, path, current.generation)) === newBytes, 'Fresh generation read wrong bytes');
    let staleReadRejected = false;
    try { await getResource(id, path, old.generation); } catch { staleReadRejected = true; }
    check(staleReadRejected, 'Old generation survived completed replacement');
    overlap.push({ read: observed.rejected ? 'rejected' : 'old-generation', staleReadRejected });
  }
  return { sameInstalledAt: first.installedAt === second.installedAt, publisherClaimIgnored: first.generation !== 'publisher-picked-generation', firstGeneration: first.generation, replacementGeneration: second.generation, generations, overlap };
};`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2022',
});
const script = fixture.outputFiles[0].contents;
const provenance = await testProvenance(import.meta.url);
const server = http.createServer((request, target) => {
  if (request.url === '/storage-test.js') {
    target.writeHead(200, { 'Content-Type': 'text/javascript' });
    target.end(script);
  } else {
    target.writeHead(200, { 'Content-Type': 'text/html' });
    target.end(
      '<!doctype html><title>Storage generation test</title><script src="/storage-test.js"></script>',
    );
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string')
  throw new Error('Storage test server missing');
const evidence: {
  provenance: typeof provenance;
  fixtureSHA256: string;
  scope: string;
  browsers: { name: string; version: string; result: GenerationProbe }[];
} = {
  provenance,
  fixtureSHA256: createHash('sha256').update(script).digest('hex'),
  scope:
    'Real IndexedDB storage generation and replacement snapshots; independent of confinement adapters',
  browsers: [],
};
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${address.port}/`);
      const result = await page.evaluate(() => window.runGenerationProbe());
      assert.equal(result.sameInstalledAt, true);
      assert.equal(result.publisherClaimIgnored, true);
      assert.notEqual(result.firstGeneration, result.replacementGeneration);
      assert.equal(new Set(result.generations).size, 14);
      assert.equal(result.overlap.length, 12);
      assert(result.overlap.every((item) => item.staleReadRejected));
      evidence.browsers.push({ name, version: browser.version(), result });
      console.log(
        `${name}: host UUIDs, replacement revocation and 12 overlapping snapshots passed`,
      );
    } finally {
      await browser.close();
    }
  }
  await mkdir('results/contexts', { recursive: true });
  await writeFile(
    'results/contexts/generation.json',
    JSON.stringify(evidence, null, 2) + '\n',
  );
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
