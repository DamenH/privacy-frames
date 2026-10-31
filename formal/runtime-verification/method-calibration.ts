import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gillianImage, verifyFixture } from './gillian.ts';

const directory = resolve(import.meta.dirname, '../../.tools/gillian-comparison');
const receipt = resolve(import.meta.dirname, 'method-calibration.json');
const upstreamRevision = '469aa5c134ba7790c40669bd4bc50483aff36d7b';
const upstreamPath = 'Gillian-JS/Examples/JaVerT/IDGen.js';
const sourceURL =
  `https://raw.githubusercontent.com/GillianPlatform/Gillian/${upstreamRevision}/` +
  upstreamPath;
const expectedSource = '32b1829ee190fbf535ab2d4748f1567e039e796fa18e9effeafc2c17651cf308';
const image = gillianImage;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
await rm(receipt, { force: true });
await mkdir(directory, { recursive: true });
const cached = resolve(directory, 'upstream-idgen.js');
let source: string;
try {
  source = await readFile(cached, 'utf8');
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
    throw error;
  const response = await fetch(sourceURL, { signal: AbortSignal.timeout(30_000) });
  assert(response.ok, 'Could not retrieve the pinned upstream verification fixture');
  source = await response.text();
  assert.equal(hash(source), expectedSource, 'Upstream fixture digest changed');
  await writeFile(cached, source);
}
assert.equal(hash(source), expectedSource, 'Cached fixture digest changed');
assert.equal(source.split('count++').length, 2, 'State-update mutation anchor changed');
const results = [];
for (const [name, code, passes] of [
  ['stateful-closure', source, true],
  ['missing-state-update', source.replace('count++', 'count'), false],
] as const) {
  results.push(
    await verifyFixture({
      directory,
      name,
      code,
      procedures: ['getId', 'reset', 'makeIdGen'],
      ...(passes ? {} : { failedProcedure: 'getId' }),
    }),
  );
  console.log(
    `${name}: ${passes ? 'all three contracts verified' : 'postcondition rejected'}`,
  );
}
await writeFile(
  receipt,
  JSON.stringify(
    {
      scope:
        'Deductive-mode calibration on an upstream stateful closure and a state-update fault. This verifies tool operation on this fixture; it does not verify a runtime component or select the production method.',
      mode: 'verify',
      image,
      imageSourceRevision: 'not-identified',
      upstreamRevision,
      upstreamPath,
      sourceURL,
      sourceSHA256: expectedSource,
      runnerSHA256: hash(await readFile(import.meta.filename, 'utf8')),
      results,
      completedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + '\n',
);
