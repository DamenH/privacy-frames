import assert from 'node:assert/strict';
import test from 'node:test';
import { publisherRegistrationScope } from '../src/runtime/publisher/scope.ts';

const context = {
  applicationURL: 'https://runtime.test/apps/installation/example/',
  installationSourceURL: 'https://publisher.test/app/index.html',
  documentBaseURL: 'https://publisher.test/app/nested/child.html',
};
const script = 'https://publisher.test/app/scripts/worker.js';

test('physical app scopes map to the installation source, including nested documents', () => {
  assert.equal(
    publisherRegistrationScope(context.applicationURL, script, context),
    'https://publisher.test/app/',
  );
  assert.equal(
    publisherRegistrationScope('/apps/installation/example/', script, context),
    'https://publisher.test/app/',
  );
  assert.equal(
    publisherRegistrationScope(context.applicationURL + 'nested/', script, context),
    'https://publisher.test/app/nested/',
  );
  assert.equal(
    publisherRegistrationScope(undefined, script, context),
    'https://publisher.test/app/scripts/',
  );
  assert.equal(
    publisherRegistrationScope('./', script, context),
    'https://publisher.test/app/nested/',
  );
});

test('foreign roots stay foreign and query/fragment rejection remains the authority gate responsibility', () => {
  assert.equal(
    publisherRegistrationScope('https://runtime.test/apps/other/', script, context),
    'https://runtime.test/apps/other/',
  );
  assert.equal(
    publisherRegistrationScope('https://outside.test/', script, context),
    'https://outside.test/',
  );
  assert.equal(
    publisherRegistrationScope(
      'https://user:pass@runtime.test/apps/installation/example/',
      script,
      context,
    ),
    'https://user:pass@runtime.test/apps/installation/example/',
  );
  assert.equal(
    publisherRegistrationScope(
      context.applicationURL + '?variant=1#section',
      script,
      context,
    ),
    'https://publisher.test/app/?variant=1#section',
  );
  assert.equal(
    publisherRegistrationScope('/app/', script, context),
    'https://publisher.test/app/',
  );
});
