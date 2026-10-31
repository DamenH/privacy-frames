import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';
import { gillianImage, verifyFixture } from './gillian.ts';

const root = resolve(import.meta.dirname, '../..');
const directory = resolve(root, '.tools/publication-generation');
const receiptPath = resolve(import.meta.dirname, 'generation-comparison.json');
await rm(receiptPath, { force: true });
await mkdir(directory, { recursive: true });
const hash = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
const modelPath = resolve(import.meta.dirname, 'PublicationModel.lean');
const model = await readFile(modelPath, 'utf8');
const executable =
  process.env.PF_LEAN || resolve(root, '.tools/lean-4.35.0-linux/bin/lean');
const version = execFileSync(executable, ['--version'], { encoding: 'utf8' }).trim();
assert(version.includes('version 4.35.0,'));
const theorems = [
  'cancel_correct',
  'cancel_returns_nothing',
  'begin_correct',
  'begin_returns_generation',
  'cancel_advances',
  'begin_advances',
  'step_generation',
  'arbitrary_sequence_generation',
];
const reports = theorems
  .map((name) => `#print axioms PublicationModel.${name}`)
  .join('\n');
const checkedPath = resolve(directory, 'CheckedModel.lean');
await writeFile(checkedPath, model + '\n' + reports + '\n');
function lean(path: string, run = false) {
  const result = spawnSync(executable, ['--trust=0', ...(run ? ['--run'] : []), path], {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}
const proof = lean(checkedPath);
assert.equal(proof.status, 0, proof.stdout + proof.stderr);
assert.equal(proof.stderr, '');
assert.equal(
  proof.stdout.trim(),
  theorems
    .map((name) => `'PublicationModel.${name}' does not depend on any axioms`)
    .join('\n'),
);
const generated = lean(modelPath, true);
assert.equal(generated.status, 0, generated.stdout + generated.stderr);
assert.equal(generated.stderr, '');
await writeFile(resolve(directory, 'generated.js'), generated.stdout);

const directPath = resolve(import.meta.dirname, 'document-publication-result.json');
const raw: unknown = JSON.parse(await readFile(directPath, 'utf8'));
assert(raw && typeof raw === 'object' && !Array.isArray(raw));
assert('mode' in raw && raw.mode === 'verify');
assert('sourceSHA256' in raw && typeof raw.sourceSHA256 === 'string');
assert('runnerSHA256' in raw && typeof raw.runnerSHA256 === 'string');
assert('results' in raw && Array.isArray(raw.results));
const direct = {
  sourceSHA256: raw.sourceSHA256,
  runnerSHA256: raw.runnerSHA256,
  results: raw.results.map((result: unknown) => {
    assert(result && typeof result === 'object' && !Array.isArray(result));
    assert('name' in result && typeof result.name === 'string');
    assert('inputSHA256' in result && typeof result.inputSHA256 === 'string');
    assert('driverSHA256' in result && typeof result.driverSHA256 === 'string');
    assert('expectedSuccess' in result && typeof result.expectedSuccess === 'boolean');
    assert('exitCode' in result && typeof result.exitCode === 'number');
    return {
      name: result.name,
      inputSHA256: result.inputSHA256,
      driverSHA256: result.driverSHA256,
      expectedSuccess: result.expectedSuccess,
      exitCode: result.exitCode,
    };
  }),
};
const productionResult = direct.results.find((result) => result.name === 'production');
assert(productionResult?.expectedSuccess && productionResult.exitCode === 0);
assert.equal(
  direct.sourceSHA256,
  hash(await readFile(resolve(root, 'src/runtime/contexts/document-publication.ts'))),
);
assert.equal(
  direct.runnerSHA256,
  hash(await readFile(resolve(import.meta.dirname, 'document-publication-check.ts'))),
);
const template = await readFile(
  resolve(root, '.tools/document-publication/production.js'),
  'utf8',
);
assert.equal(hash(template), productionResult.inputSHA256);
const names = ['beginDocumentPublication', 'cancelDocumentPublication'] as const;
function substitute(code: string) {
  const source = ts.createSourceFile('generated.js', code, ts.ScriptTarget.Latest, true);
  assert.equal(source.statements.length, 2);
  const functions = new Map<string, string>();
  for (const statement of source.statements) {
    assert(ts.isFunctionDeclaration(statement) && statement.name && statement.body);
    assert(!statement.asteriskToken && !statement.modifiers?.length);
    assert.equal(statement.parameters.length, 1);
    assert.equal(statement.parameters[0].getText(source), 'state');
    functions.set(statement.name.text, statement.getText(source));
  }
  assert.deepEqual([...functions.keys()].sort(), [...names]);
  const target = ts.createSourceFile(
    'production.js',
    template,
    ts.ScriptTarget.Latest,
    true,
  );
  const edits = target.statements.filter(ts.isFunctionDeclaration).map((node) => {
    assert(node.name);
    const replacement = functions.get(node.name.text);
    assert(replacement);
    return { start: node.getStart(target), end: node.end, replacement };
  });
  assert.equal(edits.length, 2);
  let output = template;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
  return output;
}
const verified = await verifyFixture({
  directory,
  name: 'generated',
  code: substitute(generated.stdout),
  procedures: names,
});

const anchor = '.write .ready false';
assert.equal(model.split(anchor).length, 2);
const wrongModel = model.replace(anchor, '.write .ready true');
const wrongPath = resolve(directory, 'WrongModel.lean');
await writeFile(wrongPath, wrongModel + '\n' + reports + '\n');
const rejected = lean(wrongPath);
assert.notEqual(rejected.status, 0);
assert.match(rejected.stdout, /Tactic `rfl` failed/);
await writeFile(resolve(directory, 'wrong-model.log'), rejected.stdout + rejected.stderr);
assert.equal(generated.stdout.split('state.ready = false;').length, 2);
const wrongEmission = generated.stdout.replace(
  'state.ready = false;',
  'state.ready = true;',
);
const emitterFault = await verifyFixture({
  directory,
  name: 'wrong-emission',
  code: substitute(wrongEmission),
  procedures: names,
  failedProcedure: 'cancelDocumentPublication',
});
assert.equal(await readFile(modelPath, 'utf8'), model);
const sharedDriver = await readFile(resolve(import.meta.dirname, 'gillian.ts'), 'utf8');
assert.equal(productionResult.driverSHA256, hash(sharedDriver));
await writeFile(
  receiptPath,
  JSON.stringify(
    {
      scope:
        'Comparison on the production document begin/cancel component. Lean proves the abstract update programs and generates a candidate; Gillian independently verifies the candidate with the exact production JavaScript contracts. The emitter is not a verified JavaScript compiler, and browser/caller contracts are not discharged.',
      selectedProductionMethod: 'deductive-javascript-verification',
      selectionReason:
        'Both candidates satisfy the same JavaScript heap contracts. Generation retains the JavaScript verifier and adds a model, instruction semantics, emitter and rendering obligations; it removes no trusted boundary for this component. Keep the hand-written TypeScript component and its deductive verification.',
      productionSourceSHA256: direct.sourceSHA256,
      productionFixtureSHA256: hash(template),
      directReceiptSHA256: hash(await readFile(directPath)),
      modelSHA256: hash(model),
      generatedJavaScriptSHA256: hash(generated.stdout),
      runnerSHA256: hash(await readFile(import.meta.filename)),
      typescriptVersion: ts.version,
      leanVersion: version,
      leanExecutableSHA256: hash(await readFile(executable)),
      image: gillianImage,
      proofOutput: proof.stdout.trim(),
      abstractGeneration:
        'Per-record natural-number ghost names. Emitted JavaScript uses object allocation, never numeric increment. Heap freshness is checked by the independent JavaScript contracts.',
      generatedVerification: verified,
      wrongModelControl: {
        disposition: 'proof-rejected',
        sourceSHA256: hash(wrongModel),
        outputSHA256: hash(rejected.stdout + rejected.stderr),
      },
      wrongEmitterControl: emitterFault,
      measuredInputs: {
        productionSourceBytes: (
          await readFile(resolve(root, 'src/runtime/contexts/document-publication.ts'))
        ).byteLength,
        directRunnerBytes: (
          await readFile(resolve(import.meta.dirname, 'document-publication-check.ts'))
        ).byteLength,
        sharedVerifierDriverBytes: Buffer.byteLength(sharedDriver),
        additionalModelBytes: Buffer.byteLength(model),
        additionalGenerationRunnerBytes: (await readFile(import.meta.filename))
          .byteLength,
        generatedJavaScriptBytes: Buffer.byteLength(generated.stdout),
      },
      completedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'Eight axiom-free model theorem reports; generated JavaScript verified; bad model and emitter rejected; direct verification selected for this component',
);
