import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const directory = import.meta.dirname;
const root = resolve(directory, '../..');
const hash = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');
type Row = Record<string, unknown>;
function row(value: unknown): Row {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  return value as Row;
}
function text(value: unknown): string {
  assert(typeof value === 'string' && value.length > 0);
  return value;
}
function number(value: unknown): number {
  assert(typeof value === 'number' && Number.isFinite(value));
  return value;
}
function rows(value: unknown): Row[] {
  assert(Array.isArray(value));
  return value.map(row);
}
interface Edge {
  from: string;
  to: string;
  action: string;
}
interface Step {
  action: string | null;
  origin: string;
  time?: number;
}
execFileSync('python3', [resolve(directory, 'generate-lifecycle.py')], {
  cwd: root,
  stdio: 'inherit',
});
const graphBytes = await readFile(resolve(directory, 'lifecycle-graph.json'));
const graph = row(JSON.parse(graphBytes.toString()));
const initial = text(graph.initial);
const nodes = new Map(
  Object.entries(row(graph.nodes)).map(([id, state]) => [id, row(state)]),
);
const edges: Edge[] = rows(graph.edges).map((value) => ({
  from: text(value.from),
  to: text(value.to),
  action: text(value.action),
}));
assert(nodes.has(initial));
for (const edge of edges) assert(nodes.has(edge.from) && nodes.has(edge.to));
for (const [name, digest] of Object.entries(row(graph.inputs)))
  assert.equal(hash(await readFile(resolve(root, 'formal/confinement', name))), digest);

function follow(steps: readonly Step[]) {
  let current = initial;
  const witness: object[] = [];
  for (const step of steps) {
    if (step.action === null) {
      witness.push({ ...step, from: current, to: current });
      continue;
    }
    const choices = edges.filter(
      (edge) => edge.from === current && edge.action === step.action,
    );
    assert.equal(
      choices.length,
      1,
      'No unique TLC edge for ' +
        step.action +
        ' from ' +
        JSON.stringify(nodes.get(current)),
    );
    const next = choices[0].to;
    witness.push({ ...step, from: current, to: next, state: nodes.get(next) });
    current = next;
  }
  return witness;
}
function project(value: Row) {
  assert.equal(
    value.failure,
    undefined,
    'Only completed browser schedules can be compared',
  );
  const probe = row(value.probe),
    ordering = row(value.ordering);
  assert.equal(probe.prepared, true);
  assert.equal(probe.published, true);
  assert.equal(probe.gateMarker, false);
  assert.equal(probe.hiddenAuthority, false);
  assert.deepEqual(value.receiverRequests, []);
  const trace = rows(value.trace),
    bindings = trace.filter((event) => event.kind === 'bind-success');
  assert.equal(
    bindings.length,
    2,
    'This projection supports exactly one root and one child',
  );
  const rootBinding = bindings.find((event) => event.parent === null);
  assert(rootBinding);
  const childBinding = bindings.find((event) => event.context === value.contextId);
  assert(childBinding && childBinding !== rootBinding);
  assert.equal(
    childBinding.parent,
    rootBinding.client,
    'Child has a different actual browser parent',
  );
  assert.equal(childBinding.application, rootBinding.application);
  assert.equal(
    childBinding.generation,
    rootBinding.generation,
    'Installation replacement is outside this projection',
  );
  assert.notEqual(childBinding.client, rootBinding.client);
  assert.notEqual(childBinding.context, rootBinding.context);
  for (const [binding, destination] of [
    [rootBinding, 'document'],
    [childBinding, 'iframe'],
  ] as const) {
    assert(
      trace.some(
        (event) =>
          event.kind === 'native-fetch' &&
          event.trusted === true &&
          event.mode === 'navigate' &&
          event.destination === destination &&
          event.resulting === binding.client &&
          event.url === binding.url,
      ),
      'Binding does not correlate to a real native reserved-client event',
    );
  }
  const pausedAt = number(ordering.pausedAt),
    changedAt = number(ordering.changedAt),
    releasedAt = number(ordering.releasedAt),
    startedAt = number(ordering.startedAt);
  assert.equal(startedAt, probe.startedAt);
  assert(number(rootBinding.time) <= number(childBinding.time));
  assert(
    number(childBinding.time) <= pausedAt &&
      pausedAt <= releasedAt &&
      releasedAt <= startedAt,
  );
  assert(changedAt >= pausedAt);
  const prefix: Step[] = [
    {
      action: 'CreateRoot',
      origin: 'native root binding',
      time: number(rootBinding.time),
    },
    { action: 'Prepare(root)', origin: 'UNOBSERVED root-startup prefix assumption' },
    { action: 'Publish(root)', origin: 'UNOBSERVED root-startup prefix assumption' },
    { action: 'Run(root)', origin: 'UNOBSERVED root-startup prefix assumption' },
    {
      action: 'CreateChild(child,root)',
      origin: 'native child binding with actual owner',
      time: number(childBinding.time),
    },
  ];
  const events: { time: number; rank: number; steps: Step[] }[] = [
    {
      time: pausedAt,
      rank: 0,
      steps: [
        {
          action: 'Prepare(child)',
          origin: 'trusted local-guard pause point',
          time: pausedAt,
        },
      ],
    },
    {
      time: changedAt,
      rank: 1,
      steps: [
        {
          action: null,
          origin: 'native controller upgrade; NOT installation Replace',
          time: changedAt,
        },
      ],
    },
    {
      time: releasedAt,
      rank: 2,
      steps: [
        {
          action: null,
          origin: 'test pause release; original handshake still required',
          time: releasedAt,
        },
      ],
    },
    {
      time: startedAt,
      rank: 3,
      steps: [
        {
          action: 'Publish(child)',
          origin: 'INFERRED between release and application probe',
          time: startedAt,
        },
        { action: 'Run(child)', origin: 'fixed application probe', time: startedAt },
      ],
    },
  ];
  const steps = [
    ...prefix,
    ...events
      .sort((left, right) => left.time - right.time || left.rank - right.rank)
      .flatMap((event) => event.steps),
  ];
  return {
    steps,
    binding: {
      rootClient: rootBinding.client,
      childClient: childBinding.client,
      installationGeneration: childBinding.generation,
    },
  };
}

const browserBytes = await readFile(resolve(directory, 'local-results.json'));
const receipt = row(JSON.parse(browserBytes.toString()));
const provenance = row(receipt.provenance);
assert.equal(
  hash(await readFile(resolve(directory, 'local-run.ts'))),
  provenance.runnerSHA256,
  'Receipt was produced by a different runner',
);
assert.equal(
  hash(await readFile(resolve(directory, 'local-guard.ts'))),
  receipt.localGateSHA256,
);
assert.equal(
  hash(await readFile(resolve(directory, 'observer.ts'))),
  receipt.observerSHA256,
);
const cases = rows(receipt.browsers);
assert.equal(cases.length, 4);
const compared: object[] = [],
  calibrations: object[] = [];
function reject(name: string, steps: Step[]) {
  let reason = '';
  try {
    follow(steps);
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  }
  assert(reason, 'Fault calibration was accepted: ' + name);
  calibrations.push({ name, rejected: true, reason });
}
for (const browser of cases) {
  const identity = text(browser.name) + ':' + text(browser.schedule);
  const projection = project(browser),
    witness = follow(projection.steps);
  compared.push({
    identity,
    binding: projection.binding,
    projection: projection.steps,
    witness,
  });
  reject(
    identity + ':missing-inferred-child-Publish',
    projection.steps.filter((step) => step.action !== 'Publish(child)'),
  );
  const badOwner = {
    ...browser,
    trace: rows(browser.trace).map((event) =>
      event.kind === 'bind-success' && event.context === browser.contextId
        ? { ...event, parent: 'not-the-browser-parent' }
        : event,
    ),
  };
  assert.throws(() => project(badOwner), /different actual browser parent/);
  calibrations.push({
    name: identity + ':forged-observed-parent',
    rejected: true,
    reason: 'Projection rejected a child binding with a different actual browser parent',
  });
  const badReservedClient = {
    ...browser,
    trace: rows(browser.trace).map((event) =>
      event.kind === 'native-fetch' &&
      event.destination === 'iframe' &&
      String(event.url).includes('/__contexts/')
        ? { ...event, resulting: 'claimed-browser-client' }
        : event,
    ),
  };
  assert.throws(() => project(badReservedClient), /real native reserved-client/);
  calibrations.push({
    name: identity + ':forged-observed-reserved-client',
    rejected: true,
    reason: 'Projection rejected a bind without a matching native reserved-client event',
  });
  reject(
    identity + ':missing-child-Prepare',
    projection.steps.filter((step) => step.action !== 'Prepare(child)'),
  );
  const withoutPrepare = projection.steps.filter(
    (step) => step.action !== 'Prepare(child)',
  );
  reject(identity + ':child-Prepare-after-Run', [
    ...withoutPrepare,
    { action: 'Prepare(child)', origin: 'calibration misplaced preparation' },
  ]);
  const earlyPublish = projection.steps.filter(
    (step) => step.action !== 'Publish(child)',
  );
  const prepareIndex = earlyPublish.findIndex((step) => step.action === 'Prepare(child)');
  earlyPublish.splice(prepareIndex, 0, {
    action: 'Publish(child)',
    origin: 'calibration early publication',
  });
  reject(identity + ':Publish-before-Prepare', earlyPublish);
  reject(
    identity + ':wrong-model-parent',
    projection.steps.map((step) =>
      step.action === 'CreateChild(child,root)'
        ? { ...step, action: 'CreateChild(child,child)' }
        : step,
    ),
  );
  if (browser.schedule === 'upgrade-before-release')
    reject(
      identity + ':controller-upgrade-misclassified-as-Replace',
      projection.steps.map((step) =>
        step.origin.startsWith('native controller upgrade')
          ? { ...step, action: 'Replace' }
          : step,
      ),
    );
}
assert.equal(new Set(cases.map((value) => text(value.name))).size, 2);
assert.equal(new Set(cases.map((value) => text(value.schedule))).size, 2);
assert.equal(
  new Set(cases.map((value) => text(value.name) + ':' + text(value.schedule))).size,
  4,
);
const output = {
  scope:
    'Partial-observation completion against the unchanged TLC LifecycleSafe graph. Root startup is assumed; child Publish is inferred. This is not whole-runtime refinement or proof of all model invariants.',
  generatedAt: new Date().toISOString(),
  inputs: {
    browserReceiptSHA256: hash(browserBytes),
    graphSHA256: hash(graphBytes),
    checkerSHA256: hash(await readFile(import.meta.filename)),
    generatorSHA256: hash(await readFile(resolve(directory, 'generate-lifecycle.py'))),
  },
  assumptions: [
    'The root has completed Prepare/Publish/Run before the fixture invokes child creation; these transitions were not separately observed.',
    'The trusted local pause point denotes completion of the reviewed guard preparation sequence; selected app probes do not prove every postcondition.',
    'One child Publish occurred after release and no later than the application probe. Exact publication time and transient earlier exposure are not observed.',
    'A native controller change preserves the installation generation and stutters in Lifecycle; it is not Lifecycle.Replace.',
    'No authority-message acceptance, installation replacement, revocation or full browser-effect trace is projected.',
  ],
  compared,
  calibrations,
};
await writeFile(
  resolve(directory, 'lifecycle-comparison.json'),
  JSON.stringify(output, null, 2) + '\n',
);
console.log(
  compared.length +
    ' observed schedules completed against TLC; ' +
    calibrations.length +
    ' faulty projections rejected.',
);
