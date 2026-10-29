import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// This gate intentionally fails until the migration's complete first contract
// passes. Diagnostic probe runners establish observations, not qualification.
const read = async (name: string) =>
  JSON.parse(await readFile(`results/realms/${name}.json`, 'utf8'));
const [adapters, dom, classic, loading, buffers] = await Promise.all([
  read('adapters'),
  read('dom'),
  read('classic-spike'),
  read('loading-spike'),
  read('buffers'),
]);
const strategies = new Map<string, { matching: number; total: number }>();
for (const row of classic.results) {
  const key = `${row.browser}/${row.backend}/${row.strategy}`;
  const group = strategies.get(key) || { matching: 0, total: 0 };
  group.total++;
  if (row.matches) group.matching++;
  strategies.set(key, group);
}
const modes = ['chromium/native', 'chromium/membrane', 'firefox/membrane'];
const strategyNames = [...new Set(classic.results.map((row) => row.strategy))];
const qualifiedStrategies = strategyNames.filter((strategy) =>
  modes.every((mode) => {
    const result = strategies.get(`${mode}/${strategy}`);
    return result && result.total > 0 && result.matching === result.total;
  }),
);
const gates = {
  adapterBoundary:
    adapters.results.length === 3 &&
    adapters.results.every(
      (row) => row.objectRejected && row.callbackObjectRejected && row.separate,
    ),
  synchronousDOM:
    dom.rows.length === 3 &&
    dom.rows.every(
      (row) =>
        row.result.clicked &&
        row.result.sameTarget &&
        row.result.sameThis &&
        row.revoked.denied,
    ),
  portableClassicSemantics: qualifiedStrategies.length > 0,
  productionModuleCompiler: loading.systemRegisterProof.fixtureCompilerOnly === false,
  nativeGuestWasm:
    buffers.result?.wasm?.worked === true &&
    buffers.result?.asyncCapabilities?.wasm?.worked === true,
  primitiveBufferCopy:
    buffers.result?.sizes?.every((row) => row.correct) === true &&
    buffers.result?.worker?.guestChecksum === buffers.result?.worker?.expectedChecksum,
};
const receipt = {
  testedAt: new Date().toISOString(),
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  runnerSHA256: createHash('sha256')
    .update(await readFile(new URL(import.meta.url)))
    .digest('hex'),
  scope:
    'First-milestone prerequisites only; passing would still require authority qualification, code reduction and full migration gates.',
  gates,
  classicStrategies: Object.fromEntries(strategies),
  prerequisitesPassed: Object.values(gates).every(Boolean),
  releaseQualification: 'Not evaluated by this prerequisite runner',
};
await writeFile(
  'results/realms/qualification.json',
  JSON.stringify(receipt, null, 2) + '\n',
);
for (const [name, passed] of Object.entries(gates))
  console.log(`${passed ? 'PASS' : 'INCOMPLETE'} ${name}`);
assert(
  Object.values(gates).every(Boolean),
  'Realm migration first gate is incomplete; diagnostic successes are not a qualified replacement runtime',
);
