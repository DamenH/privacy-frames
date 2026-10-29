import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseResourceList,
  RESOURCE_LIST_BYTES,
} from '../src/installation/resource-list.ts';

test('URI lists normalize absolute URLs, comments, whitespace and duplicates', () => {
  assert.deepEqual(
    parseResourceList(
      '\uFEFF# Application resources\r\nhttps://publisher.test/asset.js#section\r\n\r\n https://publisher.test/asset.js \nhttps://cdn.test/image.png?q=1\n',
    ),
    ['https://publisher.test/asset.js', 'https://cdn.test/image.png?q=1'],
  );
  assert.deepEqual(parseResourceList('http://127.0.0.1:4218/app.js'), [
    'http://127.0.0.1:4218/app.js',
  ]);
});

test('URI lists reject ambiguous and non-downloadable entries with line numbers', () => {
  for (const value of [
    'assets/module.js',
    '/root.js',
    'http://remote.test/file',
    'file:///etc/passwd',
    'data:text/plain,hello',
    'https://user:pass@publisher.test/file',
  ])
    assert.throws(() => parseResourceList('# Comment\n' + value), /line 2/);
  assert.throws(() => parseResourceList('# no files\n'), /no URLs/);
});

test('URI-list work is bounded before any requests are made', () => {
  assert.throws(
    () => parseResourceList('#' + 'x'.repeat(RESOURCE_LIST_BYTES)),
    /256 KiB/,
  );
  assert.throws(
    () =>
      parseResourceList(
        Array.from({ length: 1001 }, (_, n) => 'https://publisher.test/' + n).join('\n'),
      ),
    /Too many/,
  );
});
