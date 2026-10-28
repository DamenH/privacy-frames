import assert from 'node:assert/strict';
import test from 'node:test';
import { preparationCrypto } from '../src/installation/preparation-crypto.ts';

test('preparation hashing exposes only digest and preserves native validation', async () => {
  const capability = preparationCrypto(crypto);
  assert.deepEqual(Reflect.ownKeys(capability), ['subtle']);
  assert.deepEqual(Reflect.ownKeys(capability.subtle), ['digest']);
  const bytes = new TextEncoder().encode('abc');
  const result = await capability.subtle.digest('SHA-256', bytes);
  assert.equal(
    Buffer.from(result).toString('hex'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  await assert.rejects(capability.subtle.digest('unsupported-hash', bytes));
});

test('preparation hashing uses the captured native operation and honors view bounds', async () => {
  const original = crypto.subtle.digest.bind(crypto.subtle);
  const subtle = { digest: original };
  const capability = preparationCrypto({ subtle });
  subtle.digest = () => {
    throw new Error('Replacement must not be called');
  };
  const bytes = new TextEncoder().encode('-abc-');
  const result = await capability.subtle.digest(
    { name: 'SHA-256' },
    bytes.subarray(1, 4),
  );
  assert.equal(
    Buffer.from(result).toString('hex'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});
