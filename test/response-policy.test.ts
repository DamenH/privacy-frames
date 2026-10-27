import test from 'node:test';
import assert from 'node:assert/strict';
import { response } from '../src/runtime/response-policy.ts';

test('worker startup defaults to refusal and accepts only an explicit HTTP bootstrap directory', () => {
  assert.match(
    response('default').headers.get('Content-Security-Policy')!,
    /(?:^|; )worker-src 'none'(?:;|$)/,
  );
  for (const workerSource of [
    'https://runtime.test/installation/__contexts/',
    'http://127.0.0.1:4341/installation/__contexts/',
  ]) {
    const policy = response('bootstrap', 'text/javascript', 200, {
      workerSource,
    }).headers.get('Content-Security-Policy')!;
    assert(policy.includes(`; worker-src ${workerSource};`));
    assert(!policy.includes("worker-src 'self'"));
    assert(!policy.includes('worker-src blob:'));
  }
});

test('worker bootstrap sources reject ambiguous URLs, credentials and CSP separators', () => {
  for (const workerSource of [
    'https://runtime.test/no-trailing-slash',
    'https://runtime.test/contexts/?',
    'https://runtime.test/contexts/?query=1',
    'https://runtime.test/contexts/#',
    'https://runtime.test/contexts/#fragment',
    'https://user@runtime.test/contexts/',
    'https://user:password@runtime.test/contexts/',
    'https://runtime.test/contexts/;script-src/',
    'https://runtime.test/contexts/\n',
    'https://runtime.test/contexts/ other-source/',
    "https://runtime.test/contexts/'/",
    'blob:https://runtime.test/context',
    'data:text/javascript,postMessage(1)',
    '/relative/contexts/',
  ]) {
    assert.throws(() =>
      response('unavailable', 'text/javascript', 200, { workerSource }),
    );
  }
});

test('worker policy can name its controlling script without allowing its directory', () => {
  const workerSource = 'https://runtime.test/app/__contexts/';
  const controllerSource = 'https://runtime.test/sw.js';
  const policy = response('bootstrap', 'text/javascript', 200, {
    workerSource,
    controllerSource,
  }).headers.get('Content-Security-Policy')!;
  assert(policy.includes(`; worker-src ${workerSource} ${controllerSource};`));
  for (const invalid of [
    'https://other.test/sw.js',
    'https://runtime.test/',
    'https://runtime.test/sw.js?',
    'https://runtime.test/sw.js#',
    'https://runtime.test/sw.js;worker-src',
  ]) {
    assert.throws(() =>
      response('bootstrap', 'text/javascript', 200, {
        workerSource,
        controllerSource: invalid,
      }),
    );
  }
  assert.throws(() => response('', 'text/javascript', 200, { controllerSource }));
});
