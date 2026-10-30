import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import {
  CONTEXT_POLICY_VERSION,
  ContextRegistry,
  type ContextIdentity,
  type ContextStorage,
} from '../../src/runtime/contexts/model.ts';

execFileSync('python3', ['formal/confinement/generate-registry.py'], {
  stdio: 'inherit',
});
const graph: unknown = JSON.parse(
  await readFile('formal/confinement/registry-graph.json', 'utf8'),
);
assert(
  graph &&
    typeof graph === 'object' &&
    'nodes' in graph &&
    'edges' in graph &&
    'inputs' in graph,
);
assert(graph.nodes && typeof graph.nodes === 'object' && !Array.isArray(graph.nodes));
assert(Array.isArray(graph.edges));
const canonical = (value: object) =>
  JSON.stringify(
    Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))),
  );
const nodes = new Map<string, string>();
for (const [id, value] of Object.entries(graph.nodes)) {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  nodes.set(id, canonical(value));
}
const edges = new Set<string>();
for (const edge of graph.edges) {
  assert(
    edge &&
      typeof edge === 'object' &&
      typeof edge.from === 'string' &&
      typeof edge.to === 'string' &&
      typeof edge.action === 'string',
  );
  assert(nodes.has(edge.from) && nodes.has(edge.to));
  edges.add(JSON.stringify([nodes.get(edge.from), edge.action, nodes.get(edge.to)]));
}
assert(nodes.size >= 10);
const identity: ContextIdentity = {
  policyVersion: CONTEXT_POLICY_VERSION,
  installationGeneration: 'generation',
  id: 'context',
  application: 'app',
  parent: 'owner',
  kind: 'dedicated-worker',
  state: 'preparing',
  url: 'https://runtime.test/worker',
};
const actions = [
  'Bind',
  'Ready',
  'CloseOwner',
  'CloseOther',
  'Replace',
  'TransitionReady',
  'TransitionRunning',
  'TransitionClosed',
  'WrongClient',
  'WrongURL',
] as const;
type Action = (typeof actions)[number];
const samples: object[] = [];
let count = 0,
  transitions = 0;
async function exercise(sequence: readonly Action[]) {
  const records = new Map<string, ContextIdentity>();
  const closures = new Set<string>();
  const key = (parent: string, app: string, context: string) =>
    JSON.stringify([parent, app, context]);
  const storage: ContextStorage = {
    async get(client) {
      const entry = records.get(client);
      return entry?.parent && closures.has(key(entry.parent, entry.application, entry.id))
        ? { ...entry, state: 'closed' }
        : entry;
    },
    async put(client, value) {
      records.set(client, value);
    },
    async lookupByContext(context) {
      return [...records].find(([, value]) => value.id === context)?.[0];
    },
    async isClosureRequested(parent, app, context) {
      return closures.has(key(parent, app, context));
    },
    async requestClosure(parent, app, context) {
      closures.add(key(parent, app, context));
    },
  };
  let registry = new ContextRegistry(storage);
  const snapshot = () => ({
    state: records.get('client')?.state ?? 'absent',
    closedByOwner: closures.has(key('owner', 'app', 'context')),
    closedByOther: closures.has(key('other', 'app', 'context')),
    badBind: false,
    badRevive: false,
    badClose: false,
  });
  const trace: object[] = [];
  for (const action of sequence) {
    const before = snapshot();
    let outcome: unknown = null;
    try {
      if (action === 'Bind') {
        await registry.bind('client', { ...identity });
        outcome = 'bound';
      }
      if (action === 'Ready')
        outcome = await registry.markResourceReady('context', 'client');
      if (action === 'CloseOwner')
        outcome = await registry.closeChild('owner', 'app', 'context');
      if (action === 'CloseOther')
        outcome = await registry.closeChild(
          process.env.REGISTRY_FAULT === 'wrong-owner' ? 'owner' : 'other',
          'app',
          'context',
        );
      if (action === 'TransitionReady') {
        await registry.transition({ id: 'client', url: identity.url }, 'ready');
        outcome = 'transitioned';
      }
      if (action === 'TransitionRunning') {
        await registry.transition({ id: 'client', url: identity.url }, 'running');
        outcome = 'transitioned';
      }
      if (action === 'TransitionClosed') {
        await registry.transition({ id: 'client', url: identity.url }, 'closed');
        outcome = 'transitioned';
      }
      if (action === 'WrongClient') {
        await registry.transition({ id: 'other-client', url: identity.url }, 'closed');
        outcome = 'transitioned';
      }
      if (action === 'WrongURL') {
        await registry.transition(
          { id: 'client', url: 'https://runtime.test/wrong' },
          'closed',
        );
        outcome = 'transitioned';
      }
      if (action === 'Replace') {
        registry = new ContextRegistry(storage);
        outcome = 'replaced';
      }
    } catch (error) {
      outcome = error instanceof Error ? 'rejected: ' + error.message : 'rejected';
    }
    const after = snapshot();
    const stored = records.get('client');
    if (stored) {
      assert.equal(stored.id, identity.id);
      assert.equal(stored.application, identity.application);
      assert.equal(stored.parent, identity.parent);
      assert.equal(stored.installationGeneration, identity.installationGeneration);
      assert.equal(stored.url, identity.url);
    }
    const live =
      ['preparing', 'ready', 'running'].includes(after.state) && !after.closedByOwner;
    const direct = await registry.resourceCapability('context', 'client');
    const bearer = await registry.resourceCapability('context', '');
    const stranger = await registry.resourceCapability('context', 'other-client');
    assert.equal(Boolean(direct), live);
    assert.equal(Boolean(bearer), live);
    assert.equal(stranger, undefined);
    const from = canonical(before),
      to = canonical(after);
    assert(
      [...nodes.values()].includes(from) && [...nodes.values()].includes(to),
      'registry model mismatch: ' +
        JSON.stringify({ sequence, action, before, after, outcome }),
    );
    assert(
      from === to || edges.has(JSON.stringify([from, action, to])),
      'registry model mismatch: ' +
        JSON.stringify({ sequence, action, before, after, outcome }),
    );
    if (action === 'WrongClient' || action === 'WrongURL')
      assert(String(outcome).startsWith('rejected:'));
    if (action === 'CloseOther' && before.state !== 'absent')
      assert.equal(outcome, false);
    if (action === 'Ready' && ['absent', 'closed'].includes(before.state))
      assert.equal(outcome, false);
    if (action === 'Bind' && before.closedByOwner)
      assert(String(outcome).startsWith('rejected:'));
    trace.push({
      action,
      before,
      outcome,
      after,
      capabilities: {
        direct: Boolean(direct),
        bearer: Boolean(bearer),
        stranger: Boolean(stranger),
      },
    });
    transitions++;
  }
  count++;
  if (
    sequence.join(',') === 'CloseOwner,Replace,Bind,Ready' ||
    sequence.join(',') === 'Bind,Ready,CloseOwner,Ready' ||
    sequence.join(',') === 'CloseOther,Bind,Ready,CloseOwner'
  )
    samples.push({ sequence, trace });
}
async function enumerate(prefix: Action[], depth: number): Promise<void> {
  if (depth === 0) {
    await exercise(prefix);
    return;
  }
  for (const action of actions) await enumerate([...prefix, action], depth - 1);
}
await enumerate([], 4);
assert.equal(count, 10000);
assert.equal(samples.length, 3);
await writeFile(
  'formal/confinement/registry-implementation-traces.json',
  JSON.stringify(
    {
      scope:
        '10000 length-four sequential operation traces against the actual ContextRegistry, using an in-memory ContextStorage. No browser guard, native client identity or concurrent storage interleaving is verified.',
      modelInputs: graph.inputs,
      runnerSHA256: createHash('sha256')
        .update(await readFile('formal/confinement/registry-trace-test.ts'))
        .digest('hex'),
      sourceSHA256: createHash('sha256')
        .update(await readFile('src/runtime/contexts/model.ts'))
        .digest('hex'),
      sequences: count,
      transitions,
      samples,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `${count} actual registry sequences, ${transitions} transitions matched the TLC graph or stuttered`,
);
