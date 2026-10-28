import assert from 'node:assert/strict';
import test from 'node:test';
import {
  expectedPreparationError,
  type InstallationError,
  type InstallationOutcome,
  type PreparationWorkerDiagnostic,
  preparationErrorCategory,
} from './helpers/installation-errors.ts';

const worker = 'https://installer.test/install-worker.js';
const error: InstallationError = {
  role: 'manager',
  phase: 'installation',
  installationURL: 'https://publisher.test/application/',
  message: 'Synthetic optional failure',
  name: 'TypeError',
  stack: 'TypeError: Synthetic optional failure\n    at ' + worker + ':12:3',
  pageURL: 'https://manager.test/',
  workerURLs: [worker],
};
const installation: InstallationOutcome = {
  url: error.installationURL!,
  status: 'Installed Example.',
  outcome: { status: 'failed', reason: 'TypeError: Synthetic optional failure' },
};

test('optional worker errors require successful admission and matching recorded failure', () => {
  assert(expectedPreparationError(error, [installation], worker));
  assert(
    expectedPreparationError(
      error,
      [{ ...installation, outcome: { ...installation.outcome, status: 'unsupported' } }],
      worker,
    ),
  );
});

test('unsupported secondary errors require the same native worker exception and installation', () => {
  const tamed = { ...error, stack: '' };
  const unsupported = {
    ...installation,
    outcome: { status: 'unsupported', reason: 'No explicit lifecycle handler' },
  };
  const diagnostic: PreparationWorkerDiagnostic = {
    phase: 'installation',
    installationURL: error.installationURL,
    workerURL: worker,
    type: 'error',
    message: 'TypeError: ' + error.message,
    location: { url: worker, lineNumber: 12, columnNumber: 3 },
  };
  assert.equal(
    preparationErrorCategory(tamed, [unsupported], worker, [diagnostic]),
    'unsupported-secondary',
  );
  for (const changed of [
    { ...diagnostic, workerURL: 'https://runtime.test/worker.js' },
    { ...diagnostic, phase: 'runtime' },
    { ...diagnostic, installationURL: 'https://other.test/' },
    { ...diagnostic, message: 'Unrelated error' },
    { ...diagnostic, type: 'warning' },
  ])
    assert.equal(
      preparationErrorCategory(tamed, [unsupported], worker, [changed]),
      undefined,
    );
  assert.equal(preparationErrorCategory(tamed, [unsupported], worker), undefined);
  assert.equal(
    preparationErrorCategory(
      tamed,
      [{ ...unsupported, outcome: { ...unsupported.outcome, status: 'failed' } }],
      worker,
      [diagnostic],
    ),
    undefined,
  );
});

test('manager, application, unrelated and unrecorded errors remain unexpected', () => {
  for (const changed of [
    { ...error, role: 'application' as const },
    { ...error, phase: 'runtime' },
    { ...error, installationURL: 'https://other.test/' },
    { ...error, message: '' },
    { ...error, stack: 'at https://runtime.test/guard.js:1:1' },
    { ...error, workerURLs: [] },
    { ...error, workerURLs: ['https://publisher.test/install-worker.js'] },
  ])
    assert.equal(expectedPreparationError(changed, [installation], worker), false);
  for (const changed of [
    { ...installation, status: 'Installation refused: Invalid metadata' },
    { ...installation, outcome: { status: 'completed', reason: error.message } },
    { ...installation, outcome: { status: 'failed', reason: 'Different failure' } },
    { ...installation, outcome: { status: 'failed' } },
  ])
    assert.equal(expectedPreparationError(error, [changed], worker), false);
  assert.equal(expectedPreparationError(error, [], worker), false);
});
