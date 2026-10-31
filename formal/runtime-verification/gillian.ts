import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const gillianImage =
  'ghcr.io/gillianplatform/gillian@sha256:ce41de968aba0964774e1929416ce60b9c3b770d2e58f96e63990b629cfe2ed6';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

interface Fixture {
  directory: string;
  name: string;
  code: string;
  procedures: readonly string[];
  failedProcedure?: string;
}

export async function verifyFixture(fixture: Fixture) {
  const { directory, name, code, procedures, failedProcedure } = fixture;
  assert(/^[a-z0-9-]+$/.test(name));
  assert(procedures.length > 0, 'A successful zero-contract run is not verification');
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, name + '.js'), code);
  const container = `pf-deductive-${process.pid}-${name}`;
  const run = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--name',
      container,
      '--network',
      'none',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--user',
      `${process.getuid?.()}:${process.getgid?.()}`,
      '--mount',
      `type=bind,src=${directory},dst=/work`,
      '--workdir',
      '/work',
      gillianImage,
      'gillian-js',
      'verify',
      name + '.js',
      '--ci',
      '--logging',
      'normal',
      '--result-dir',
      '.gillian-' + name,
    ],
    { encoding: 'utf8', timeout: 180_000, maxBuffer: 4 * 1024 * 1024 },
  );
  if (run.error) {
    spawnSync('docker', ['rm', '--force', container], { encoding: 'utf8' });
    throw run.error;
  }
  const output = run.stdout + run.stderr;
  await writeFile(resolve(directory, name + '.log'), output);
  assert.equal(run.status, failedProcedure ? 1 : 0, output);
  assert(
    output.includes(`Obtained ${procedures.length} symbolic tests in total`),
    'Wrong number of procedure contracts checked',
  );
  for (const procedure of procedures) {
    const outcome = procedure === failedProcedure ? 'f Failure' : 's Success';
    assert(
      output.includes(`Verifying one spec of procedure ${procedure}... ${outcome}`),
      `Missing expected verification outcome for ${procedure}: ${output}`,
    );
  }
  if (failedProcedure) assert.match(output, /Couldn't satisfy postcondition/);
  else assert.match(output, /All specs succeeded:/);
  return {
    name,
    expectedSuccess: !failedProcedure,
    exitCode: run.status,
    inputSHA256: hash(code),
    driverSHA256: hash(await readFile(import.meta.filename, 'utf8')),
    outputSHA256: hash(output),
    outputSummary: output.trim(),
  };
}
