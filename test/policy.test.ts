import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMarkup, validateMetadata, safePath } from '../src/shared/policy.ts';
for (const html of [
  '<iframe>',
  '<IFRAME srcdoc="x">',
  '<svg><style><iframe></iframe></style></svg>',
  '<template><iframe></template>',
  '<object data="x">',
  '<embed>',
  '<frameset><frame>',
  '<fencedframe>',
  '<portal>',
  '<svg><foreignObject><iframe></foreignObject></svg>',
])
  test('reject context markup ' + html, () => assert.throws(() => validateMarkup(html)));
for (const html of [
  '<script src="x.js"></script>',
  '<link rel="preconnect" href="https://example.com">',
  '<meta http-equiv="refresh" content="0">',
  '<img onerror="x">',
  '<div is="hostile-element">',
])
  test('reject dynamic authority markup ' + html, () =>
    assert.throws(() => validateMarkup(html)),
  );
test('admit ordinary markup and native controls', () =>
  assert.doesNotThrow(() =>
    validateMarkup(
      '<div><label>Name<input required></label><button>Save</button><canvas></canvas><svg><circle r="5"/></svg></div>',
    ),
  ));
test('admit prepared external scripts and stylesheet', () =>
  assert.doesNotThrow(() =>
    validateMarkup(
      '<html><head><link rel="stylesheet" href="./app.css"></head><body><script src="./app.js"></script></body></html>',
      { document: true, initial: true },
    ),
  ));
for (const path of ['../secret', '/absolute', 'a/../x', 'a%2fb', 'a\\b', 'a?b', 'a#b'])
  test('reject path ' + path, () => assert.throws(() => safePath(path)));
test('installation metadata requires a valid label and HTML entry', () => {
  const metadata = { id: 'notes', name: 'Notes', entry: 'index.html' };
  assert.equal(validateMetadata(metadata).id, 'notes');
  assert.throws(() => validateMetadata({ ...metadata, id: '../notes' }));
  assert.throws(() => validateMetadata({ ...metadata, entry: 'app.js' }));
  assert.throws(() => validateMetadata({ id: 10, name: 'Notes', entry: 'index.html' }));
});
