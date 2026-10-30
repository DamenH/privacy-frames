import { build, type Metafile, type Plugin } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { trustedPolicyPlugin } from './trusted-policy.ts';

const root = resolve(import.meta.dirname, '..');
const baselineRevision =
  process.env.MEASUREMENT_BASELINE || '97f2b835609eedc95c9f52a470c7c32046f1b5fb';
const temporary = await mkdtemp(join(tmpdir(), 'pf-trusted-size-'));
const output = process.argv[2] || 'results/trusted-runtime/size-snapshot.json';
const entries = {
  worker: ['src/runtime/worker.ts', 'iife'],
  guard: ['src/runtime/guard.ts', 'iife'],
  connect: ['src/bridge/connect.ts', 'esm'],
  'worker-guard': ['src/runtime/contexts/worker-guard.ts', 'iife'],
  'document-guard': ['src/runtime/contexts/document-guard.ts', 'iife'],
  'shared-worker-guard': ['src/runtime/contexts/shared-worker-guard.ts', 'iife'],
  'worklet-guard': ['src/runtime/contexts/worklet-guard.ts', 'esm'],
  'publisher-worker-guard': ['src/runtime/publisher/guard.ts', 'iife'],
} as const;
const localEntries = new Set([
  'guard',
  'worker-guard',
  'document-guard',
  'shared-worker-guard',
  'worklet-guard',
  'publisher-worker-guard',
]);

async function inventory(directory: string, prefix = 'src') {
  const files: Record<string, { bytes: number; lines: number; sha256: string }> = {};
  for (const file of (
    await readdir(join(directory, prefix), { recursive: true })
  ).sort()) {
    if (!/\.(ts|tsx|css|html)$/.test(file)) continue;
    const bytes = await readFile(join(directory, prefix, file));
    const text = bytes.toString('utf8');
    files[join(prefix, file)] = {
      bytes: bytes.byteLength,
      lines: text.split('\n').length - Number(text.endsWith('\n')),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }
  return files;
}
function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function total(files: Record<string, { bytes: number; lines: number }>) {
  return Object.values(files).reduce<{ files: number; bytes: number; lines: number }>(
    (sum, item) => ({
      files: sum.files + 1,
      bytes: sum.bytes + item.bytes,
      lines: sum.lines + item.lines,
    }),
    { files: 0, bytes: 0, lines: 0 },
  );
}
function key(input: string, directory: string) {
  if (input.startsWith('trusted-policy:')) return input;
  const path = isAbsolute(input) ? input : resolve(directory, input);
  return path.includes('/node_modules/')
    ? 'node_modules/' + path.split('/node_modules/').at(-1)
    : relative(directory, path);
}
async function measure(directory: string, isolated: boolean) {
  const plugin: Plugin[] = isolated ? [await trustedPolicyPlugin(directory)] : [];
  async function compile(entry: string, format: 'iife' | 'esm', nested = false) {
    const result = await build({
      absWorkingDir: directory,
      entryPoints: [entry],
      bundle: true,
      write: false,
      metafile: true,
      outfile: 'measurement.js',
      target: 'es2022',
      format,
      ...(nested
        ? { globalName: '__trustedPolicy' }
        : {
            define: {
              __BUILD_ID__: '"baseline-measurement"',
              'process.env.NODE_ENV': '"production"',
            },
            jsx: 'automatic',
            plugins: plugin,
          }),
      banner: { js: '"use strict";' },
      logLevel: 'silent',
    });
    const bytes = result.outputFiles[0].contents;
    const embeddedTrustedDataBytes = Object.values(result.metafile.outputs).reduce(
      (sum, file) =>
        sum +
        Object.entries(file.inputs)
          .filter(([input]) => input.startsWith('trusted-policy:'))
          .reduce((subtotal, [, input]) => subtotal + input.bytesInOutput, 0),
      0,
    );
    return {
      meta: result.metafile,
      emitted: {
        bytes: bytes.byteLength,
        gzipBytes: gzipSync(bytes, { level: 9 }).byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        embeddedTrustedDataBytes,
        executableAndWrapperBytes: bytes.byteLength - embeddedTrustedDataBytes,
        contributions: Object.fromEntries(
          Object.values(result.metafile.outputs).flatMap((file) =>
            Object.entries(file.inputs).map(([input, contribution]) => [
              key(input, directory),
              contribution.bytesInOutput,
            ]),
          ),
        ),
      },
    };
  }
  const builds = await Promise.all(
    Object.entries(entries).map(async ([name, [entry, format]]) => ({
      name,
      ...(await compile(entry, format)),
    })),
  );
  const nested = isolated
    ? await compile('src/runtime/trusted/entry.ts', 'iife', true)
    : undefined;
  const allMetas: Metafile[] = builds.map((item) => item.meta);
  if (nested) allMetas.push(nested.meta);
  const localKeys = new Set(
    builds
      .filter((item) => localEntries.has(item.name))
      .flatMap((item) =>
        Object.keys(item.meta.inputs).map((input) => key(input, directory)),
      ),
  );
  const isolatedKeys = new Set(
    Object.keys(nested?.meta.inputs || {}).map((input) => key(input, directory)),
  );
  const records: Record<
    string,
    { bytes: number; lines: number; sha256: string; placement: string }
  > = {};
  const virtual: Record<string, number> = {};
  for (const input of new Set(allMetas.flatMap((meta) => Object.keys(meta.inputs)))) {
    const name = key(input, directory);
    if (input.startsWith('trusted-policy:')) {
      virtual[name] = Math.max(...allMetas.map((meta) => meta.inputs[input]?.bytes || 0));
      continue;
    }
    const bytes = await readFile(isAbsolute(input) ? input : resolve(directory, input));
    records[name] = {
      bytes: bytes.byteLength,
      lines:
        bytes.toString('utf8').split('\n').length -
        Number(bytes.toString('utf8').endsWith('\n')),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      placement: localKeys.has(name)
        ? isolatedKeys.has(name)
          ? 'mixed-local-and-isolated'
          : 'local-executable'
        : isolatedKeys.has(name)
          ? 'isolated-only'
          : 'controller-only',
    };
  }
  const source = await inventory(directory, 'src/runtime');
  const project = Object.fromEntries(
    Object.entries(records).filter(([name]) => !name.startsWith('node_modules/')),
  );
  const dependencies = Object.fromEntries(
    Object.entries(records).filter(([name]) => name.startsWith('node_modules/')),
  );
  const placement = Object.fromEntries(
    [
      'local-executable',
      'mixed-local-and-isolated',
      'isolated-only',
      'controller-only',
    ].map((name) => [
      name,
      total(
        Object.fromEntries(
          Object.entries(records).filter(([, record]) => record.placement === name),
        ),
      ),
    ]),
  );
  return {
    runtimeSource: { total: total(source), files: source },
    reachable: {
      total: total(records),
      project: total(project),
      dependencies: total(dependencies),
      files: records,
      placement,
    },
    virtualDataModules: virtual,
    bundles: Object.fromEntries(builds.map((item) => [item.name, item.emitted])),
    deployedBundleTotals: {
      bytes: builds.reduce((sum, item) => sum + item.emitted.bytes, 0),
      gzipBytes: builds.reduce((sum, item) => sum + item.emitted.gzipBytes, 0),
    },
    nestedTrustedBundle: nested?.emitted || null,
  };
}

try {
  const before = await inventory(root);
  const baseline = join(temporary, 'baseline');
  const current = join(temporary, 'current');
  await Promise.all([mkdir(baseline), mkdir(current)]);
  execFileSync('tar', ['-x', '-C', baseline], {
    input: execFileSync('git', ['archive', baselineRevision], {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
    }),
  });
  await cp(join(root, 'src'), join(current, 'src'), { recursive: true });
  await Promise.all([
    symlink(join(root, 'node_modules'), join(baseline, 'node_modules'), 'dir'),
    symlink(join(root, 'node_modules'), join(current, 'node_modules'), 'dir'),
  ]);
  const copied = await inventory(current);
  const [oldMeasurement, newMeasurement] = await Promise.all([
    measure(
      baseline,
      Object.hasOwn(await inventory(baseline), 'src/runtime/trusted/entry.ts'),
    ),
    measure(current, true),
  ]);
  const after = await inventory(root);
  const receipt = {
    capturedAt: new Date().toISOString(),
    baselineRevision,
    currentHEAD: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    currentWorkingTreeSHA256: hash(copied),
    sourceStableDuringSnapshot:
      hash(before) === hash(copied) && hash(copied) === hash(after),
    installedLockSHA256: createHash('sha256')
      .update(await readFile(join(root, 'package-lock.json')))
      .digest('hex'),
    pluginSHA256: createHash('sha256')
      .update(await readFile(join(root, 'scripts/trusted-policy.ts')))
      .digest('hex'),
    runnerSHA256: createHash('sha256')
      .update(await readFile(new URL(import.meta.url)))
      .digest('hex'),
    method: {
      source:
        'Whole unique reachable input files, including nested trusted entry graph. Mixed input files are conservatively charged to local exposure.',
      executablePlacement:
        'Local means root/child windows, dedicated/shared/publisher workers and worklets. Controller means SW/connect only. Placement is build reachability, not a security proof.',
      virtual:
        'Embedded code string is not counted again as maintained source; its deployed bytes remain included in outer bundles.',
      nested:
        'Separate nested build reproduces trusted-policy plugin entry/settings. Nested emitted size is diagnostic; never add again to outer deployment total.',
      versions:
        'Baseline and current both resolve measuring worktree node_modules. Lock hash is recorded; dependency versions must be checked before comparing with historical release assets.',
      scope:
        'Working-tree development snapshot, not a release or a code-reduction/security gate pass.',
    },
    baseline: oldMeasurement,
    current: newMeasurement,
    delta: {
      runtimeSourceLines:
        newMeasurement.runtimeSource.total.lines -
        oldMeasurement.runtimeSource.total.lines,
      reachableLinesIncludingDependencies:
        newMeasurement.reachable.total.lines - oldMeasurement.reachable.total.lines,
      reachableBytesIncludingDependencies:
        newMeasurement.reachable.total.bytes - oldMeasurement.reachable.total.bytes,
      deploymentBytes:
        newMeasurement.deployedBundleTotals.bytes -
        oldMeasurement.deployedBundleTotals.bytes,
    },
  };
  await mkdir(resolve(root, 'results/trusted-runtime'), { recursive: true });
  await writeFile(resolve(root, output), JSON.stringify(receipt, null, 2) + '\n');
  console.log(
    JSON.stringify(
      {
        output,
        sourceStable: receipt.sourceStableDuringSnapshot,
        snapshot: receipt.currentWorkingTreeSHA256,
        baseline: oldMeasurement.reachable.total,
        current: newMeasurement.reachable.total,
        delta: receipt.delta,
        placements: newMeasurement.reachable.placement,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
