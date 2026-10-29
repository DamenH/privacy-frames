import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { servers } from './server.ts';

// Keep the successful release's publisher variants and existing task runner.
// This selects URLs, not publisher behavior or patches to application source.
const baseline = JSON.parse(
  await readFile('results/evaluation/compatibility-explicit-lists-public.json', 'utf8'),
);
const overrides = Object.fromEntries(
  baseline.results
    .filter((row) => row.browser === 'chromium')
    .map((row) => [row.id, row.url]),
);
assert.equal(Object.keys(overrides).length, 8, 'Expected the complete eight-app corpus');
const services = await servers({ receiver: false, publicExamples: true });
try {
  const child = spawn(process.execPath, ['test/evaluation-compatibility.ts'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      HOST_URL: 'http://127.0.0.1:4210/privacy-frames/',
      EVALUATION_URL_OVERRIDES: JSON.stringify(overrides),
      EVALUATION_REQUIRE_CONFINED: '1',
      EVALUATION_RESULTS:
        process.env.EVALUATION_RESULTS ||
        'results/trusted-runtime/compatibility-local.json',
    },
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  assert.equal(code, 0, 'Eight-app native/confined task and offline comparison failed');
} finally {
  await services.close();
}
