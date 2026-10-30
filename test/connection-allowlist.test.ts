import assert from 'node:assert/strict';
import test from 'node:test';
import { response } from '../src/runtime/response-policy.ts';

test('generated documents and worker responses keep an additive same-origin connection policy', () => {
  for (const type of [
    'text/html',
    'image/svg+xml',
    'text/javascript',
    'application/json',
  ]) {
    const result = response('fixture', type);
    assert.equal(
      result.headers.get('Connection-Allowlist'),
      '(response-origin); redirects=block; webrtc=block',
    );
    const csp = result.headers.get('Content-Security-Policy')!;
    assert(csp.includes("connect-src 'self' blob: data:"));
    assert(csp.includes("worker-src 'none'"));
    assert(csp.includes("form-action 'none'"));
    assert.equal(result.headers.get('Connection-Allowlist-Report-Only'), null);
    assert.equal(result.headers.get('Reporting-Endpoints'), null);
  }
});
