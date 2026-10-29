import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogExamples } from '../src/manager/services/bootstrap.ts';
import {
  catalogResourceList,
  formInstallationRequest,
} from '../src/manager/installation-form.ts';

const examples = [
  {
    name: 'Editor',
    url: 'https://apps.test/editor/',
    resourceListURL: 'https://assets.test/editor.uri-list',
  },
  { name: 'Reader', url: 'https://apps.test/reader/' },
];

test('catalog metadata survives validation and exact URL selection is generic', () => {
  assert.deepEqual(catalogExamples(examples), examples);
  assert.deepEqual(catalogResourceList(examples[0].url, examples), {
    kind: 'url',
    value: examples[0].resourceListURL,
  });
  for (const url of [
    'https://apps.test/editor/?other',
    'https://apps.test/reader/',
    'https://other.test/editor/',
  ])
    assert.deepEqual(catalogResourceList(url, examples), { kind: 'none' });
  assert.throws(() =>
    catalogExamples([{ ...examples[0], resourceListURL: 'http://assets.test/list' }]),
  );
});

test('resource list choices can remove or replace a catalog default', () => {
  assert.deepEqual(formInstallationRequest(examples[0].url, { kind: 'none' }), {
    url: examples[0].url,
  });
  assert.deepEqual(
    formInstallationRequest(examples[0].url, {
      kind: 'url',
      value: 'https://custom.test/override.uri-list',
    }),
    {
      url: examples[0].url,
      resourceList: { kind: 'url', url: 'https://custom.test/override.uri-list' },
    },
  );
  const text = '# Local copy\nhttps://assets.test/image.png\n';
  assert.deepEqual(
    formInstallationRequest(examples[0].url, { kind: 'text', value: text }),
    {
      url: examples[0].url,
      resourceList: { kind: 'text', text },
    },
  );
  assert.throws(() =>
    formInstallationRequest(examples[0].url, { kind: 'text', value: '€'.repeat(87382) }),
  );
});
