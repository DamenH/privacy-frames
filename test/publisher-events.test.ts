import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublisherEvents } from '../src/runtime/publisher/events.ts';
function fixture() {
  const target = new EventTarget();
  return {
    target,
    events: createPublisherEvents(target, {
      clients: async () => [],
      unregister: async () => true,
    }),
  };
}
const request = {
  url: 'https://publisher.invalid/value.txt',
  headers: [
    ['Cookie', 'secret'],
    ['Authorization', 'token'],
    ['X-App', 'value'],
  ] as [string, string][],
  clientId: 'actual-client',
  destination: '' as RequestDestination,
};
test('publisher lifecycle waits for declared work and rejects late extension', async () => {
  const { target, events } = fixture();
  let wait: ((promise: Promise<unknown>) => void) | undefined;
  let ended = false;
  target.addEventListener('install', (event) => {
    wait = Reflect.get(event, 'waitUntil');
    wait!(
      Promise.resolve().then(() => {
        ended = true;
      }),
    );
  });
  await events.lifecycle('install');
  assert.equal(ended, true);
  assert.throws(() => wait!(Promise.resolve()), { name: 'InvalidStateError' });
});
test('publisher GET event strips shared-origin credentials and returns safe representation metadata', async () => {
  const { target, events } = fixture();
  target.addEventListener('fetch', (event) => {
    const value: Request = Reflect.get(event, 'request');
    assert.equal(value.headers.get('cookie'), null);
    assert.equal(value.headers.get('authorization'), null);
    assert.equal(value.headers.get('x-app'), 'value');
    assert.equal(value.credentials, 'omit');
    assert.equal(Reflect.get(event, 'clientId'), 'actual-client');
    Reflect.get(
      event,
      'respondWith',
    )(
      new Response('changed', {
        headers: {
          'content-type': 'text/plain',
          'set-cookie': 'ambient=1',
          refresh: '0;url=https://receiver.invalid',
          'content-security-policy': 'default-src *',
          etag: 'example',
        },
      }),
    );
  });
  const value = await events.fetch(request);
  assert.equal(value.handled, true);
  assert.equal(await value.response!.text(), 'changed');
  assert.equal(value.response!.headers.get('etag'), 'example');
  for (const name of ['set-cookie', 'refresh', 'content-security-policy'])
    assert.equal(value.response!.headers.get(name), null);
});
test('no respondWith uses graph fallback; handled rejection/redirect/executable body fails closed', async () => {
  assert.deepEqual(structuredClone(await fixture().events.fetch(request)), {
    handled: false,
  });
  for (const response of [
    Promise.reject(new Error('handler failed')),
    Promise.resolve(Response.redirect('https://receiver.invalid/')),
    Promise.resolve(
      new Response('code', { headers: { 'content-type': 'text/javascript' } }),
    ),
    Promise.resolve(
      new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }),
    ),
  ]) {
    const { target, events } = fixture();
    target.addEventListener('fetch', (event) =>
      Reflect.get(event, 'respondWith')(response),
    );
    const value = await events.fetch(request);
    assert.equal(value.handled, true);
    assert.equal(value.response!.type, 'error');
  }
});
test('application messages stay data and never become control commands', async () => {
  const { target, events } = fixture();
  const data = { type: 'privacy-publisher-ready', client: 'manager' };
  target.addEventListener('message', (event) =>
    assert.equal(Reflect.get(event, 'data'), data),
  );
  await events.message(data, null, []);
  const globals = events.globals(
    'https://publisher.invalid/worker.js',
    'https://publisher.invalid/',
  );
  assert.deepEqual(structuredClone(await globals.clients.matchAll()), []);
  await assert.rejects(globals.clients.openWindow(), { name: 'NotSupportedError' });
  assert.equal(await globals.registration.unregister(), true);
});
