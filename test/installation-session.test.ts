import test from 'node:test';
import assert from 'node:assert/strict';
import {
  installationConfiguration,
  installationReply,
  installationRequest,
  installationSession,
} from '../src/installation/session.ts';

const session = '3c158053-260d-4bb8-9033-985089d22d27';
const configuration = {
  managerURL: 'https://manager.test/',
  runtimeURL: 'https://runtime.test/',
  installationURL: 'https://installation.test/',
};

test('installation requires three distinct configured origins', () => {
  assert.equal(
    installationConfiguration(configuration, 'https://installation.test'),
    'https://manager.test',
  );
  for (const changed of [
    { installationURL: configuration.managerURL },
    { installationURL: configuration.runtimeURL },
    { runtimeURL: configuration.managerURL },
    { installationURL: 'https://installation.test/?capture=1' },
    { installationURL: 'https://user:password@installation.test/' },
    { installationURL: 'http://installation.test/' },
    { installationURL: 'https://installation.test/no-trailing-slash' },
    { managerURL: 'data:text/html,host' },
    { runtimeURL: 'https://runtime.test/#fragment' },
  ])
    assert.throws(() =>
      installationConfiguration(
        { ...configuration, ...changed },
        'https://installation.test',
      ),
    );
  assert.throws(() => installationConfiguration(configuration, 'https://publisher.test'));
});

test('session messages reject wrong identities, malformed commands and oversized text', () => {
  assert.deepEqual(installationSession({ type: 'pf-install-connect', session }), {
    type: 'pf-install-connect',
    session,
  });
  assert.equal(installationSession({ type: 'pf-connect', session }), undefined);
  assert.equal(
    installationSession({ type: 'pf-install-connect', session: 'x' }),
    undefined,
  );
  assert.equal(
    installationRequest(
      { type: 'prepare', session, url: 'https://publisher.test/' },
      session,
    ),
    'https://publisher.test/',
  );
  for (const value of [
    null,
    { type: 'prepare', session: 'other', url: 'https://publisher.test/' },
    { type: 'fetch', session, url: 'https://publisher.test/' },
    { type: 'prepare', session, url: 'x'.repeat(16385) },
  ])
    assert.throws(() => installationRequest(value, session));
  assert.deepEqual(installationReply({ type: 'ready', session }, session), {
    type: 'ready',
    session,
  });
  for (const value of [
    { type: 'ready', session: 'other' },
    { type: 'progress', session, message: 'x'.repeat(2001) },
    { type: 'failed', session, error: null },
    { type: 'prepared', session, installation: [] },
  ])
    assert.throws(() => installationReply(value, session));
});
