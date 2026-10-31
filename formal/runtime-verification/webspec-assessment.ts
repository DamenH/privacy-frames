import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const revision = 'b7ff6b714b3a4b572c108cc3136506da3d263eff';
const files = {
  'model/Browser.v': '9e4f2a37d12b590e946a49c339f372586e9f14fb4ccecc30ec7c6e677703ebe0',
  'model/SWInvariant.v':
    '8ad2b29f726f9c985fe0e0980ef61a33ec3e56c0ded530e121eb71acd72fa7aa',
  'README.md': '9e239781cf48432e21bb44b2b9e6782f16ca0003120bec779188afd8fecc8c55',
};
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const directory = resolve(import.meta.dirname, '../../.tools/webspec-assessment');
await mkdir(directory, { recursive: true });
const sources = new Map<string, string>();
for (const [path, expected] of Object.entries(files)) {
  const target = resolve(directory, path.replaceAll('/', '-'));
  let bytes: Uint8Array;
  try {
    bytes = await readFile(target);
  } catch (error) {
    if (!(
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ))
      throw error;
    const response = await fetch(
      `https://raw.githubusercontent.com/SecPriv/webspec/${revision}/${path}`,
      {
        signal: AbortSignal.timeout(30_000),
      },
    );
    assert(response.ok, `Source download failed: ${path}`);
    bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(digest(bytes), expected, path);
    await writeFile(target, bytes);
  }
  assert.equal(digest(bytes), expected, path);
  sources.set(path, new TextDecoder().decode(bytes));
}
const browser = sources.get('model/Browser.v')!;
const worker = browser.match(/Record ServiceWorker := \{([\s\S]*?)\n\}\./)?.[1];
assert(worker);
const fields = [...worker.matchAll(/^\s*(wk_\w+)\s*:/gm)].map((match) => match[1]);
assert.deepEqual(fields, ['wk_version', 'wk_cache']);
const transitions = [...browser.matchAll(/^\| (Event_\w+)\s*:/gm)].map(
  (match) => match[1],
);
assert.equal(transitions.length, 13);
assert(transitions.includes('Event_worker_update_cache'));
assert(browser.includes('since we do not model SW registration'));
const invariant = sources.get('model/SWInvariant.v')!;
assert(invariant.includes('rp_hd_csp (rp_headers rp) = rp_hd_csp'));
const receipt = {
  scope:
    'Pinned-source coverage assessment, not a Coq proof check, solver query or browser verification. The reviewed model does not provide the registration/update lifecycle needed to represent our concrete maintenance counterexample.',
  upstream: 'https://github.com/SecPriv/webspec',
  revision,
  sourceSHA256: files,
  runnerSHA256: digest(await readFile(import.meta.filename)),
  serviceWorkerFields: fields,
  reachableEventConstructors: transitions,
  assessedObligation:
    'C4: app-controlled context creation or cached-resource delivery must not trigger a separate browser-owned service-worker update request.',
  decision:
    'Do not use unmodified WebSpec to discharge this obligation. Its cache transitions and server-CSP-integrity invariant are different properties. Modeling registration, staleness, controller inheritance and update-script fetches, with browser correspondence, would be additional work.',
  completedAt: new Date().toISOString(),
};
await writeFile(
  new URL('./webspec-assessment.json', import.meta.url),
  JSON.stringify(receipt, null, 2) + '\n',
);
console.log(
  'Pinned WebSpec sources checked: registration lifecycle omitted; C4 update obligation remains outside this model',
);
