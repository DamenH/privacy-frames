import { build, type Metafile } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const revision = process.argv[2] || '97f2b835609eedc95c9f52a470c7c32046f1b5fb';
const commit = execFileSync('git', ['rev-parse', revision + '^{commit}'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
const directory = await mkdtemp(join(tmpdir(), 'privacy-frames-baseline-'));
const require = createRequire(import.meta.url);

function size(text: string) {
  return {
    bytes: Buffer.byteLength(text),
    lines: text.length ? text.split('\n').length - Number(text.endsWith('\n')) : 0,
    nonblankLines: text.split('\n').filter((line) => line.trim()).length,
  };
}

async function sourceInventory(path: string) {
  const records: Record<string, ReturnType<typeof size>> = {};
  for (const item of (await readdir(join(directory, path), { recursive: true })).sort()) {
    if (!/\.tsx?$/.test(item)) continue;
    records[join(path, item)] = size(await readFile(join(directory, path, item), 'utf8'));
  }
  return records;
}

function total(records: Record<string, ReturnType<typeof size>>) {
  return Object.values(records).reduce<{
    files: number;
    bytes: number;
    lines: number;
    nonblankLines: number;
  }>(
    (sum, item) => ({
      files: sum.files + 1,
      bytes: sum.bytes + item.bytes,
      lines: sum.lines + item.lines,
      nonblankLines: sum.nonblankLines + item.nonblankLines,
    }),
    { files: 0, bytes: 0, lines: 0, nonblankLines: 0 },
  );
}

async function reachable(metafiles: Metafile[]) {
  const project: Record<string, ReturnType<typeof size>> = {};
  const dependencies: Record<string, ReturnType<typeof size>> = {};
  for (const input of new Set(metafiles.flatMap((meta) => Object.keys(meta.inputs)))) {
    const path = isAbsolute(input) ? input : resolve(directory, input);
    const dependency = path.includes('/node_modules/');
    const key = dependency
      ? path.slice(path.indexOf('/node_modules/') + '/node_modules/'.length)
      : relative(directory, path);
    const collection = dependency ? dependencies : project;
    collection[key] = size(await readFile(path, 'utf8'));
  }
  return {
    project: { total: total(project), files: project },
    dependencies: { total: total(dependencies), files: dependencies },
  };
}

async function bundle(entry: string, format: 'esm' | 'iife') {
  const result = await build({
    absWorkingDir: directory,
    entryPoints: [entry],
    nodePaths: [join(root, 'node_modules')],
    outfile: 'measurement.js',
    bundle: true,
    write: false,
    metafile: true,
    define: {
      __BUILD_ID__: '"baseline-measurement"',
      'process.env.NODE_ENV': '"production"',
    },
    banner: { js: '"use strict";' },
    format,
    target: 'es2022',
    jsx: 'automatic',
    logLevel: 'silent',
  });
  const output = result.outputFiles[0].contents;
  return {
    metafile: result.metafile,
    measurement: {
      bytes: output.byteLength,
      gzipBytes: gzipSync(output, { level: 9 }).byteLength,
      sha256: createHash('sha256').update(output).digest('hex'),
      inputs: Object.fromEntries(
        Object.values(result.metafile.outputs).flatMap((file) =>
          Object.entries(file.inputs).map(([input, value]) => [
            input,
            value.bytesInOutput,
          ]),
        ),
      ),
    },
  };
}

try {
  const archive = execFileSync('git', ['archive', commit], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  });
  execFileSync('tar', ['-x', '-C', directory], { input: archive });
  const runtimeFiles = await sourceInventory('src/runtime');
  const installationFiles = await sourceInventory('src/installation');
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
  const builds = await Promise.all(
    Object.entries(entries).map(async ([name, [entry, format]]) => ({
      name,
      ...(await bundle(entry, format)),
    })),
  );
  const installer = await bundle('src/installation/controller.ts', 'esm');
  let membrane: object = { installed: false };
  try {
    const entry = require.resolve('@locker/near-membrane-dom');
    let packageDirectory = dirname(entry);
    while (true) {
      try {
        const metadata: unknown = JSON.parse(
          await readFile(join(packageDirectory, 'package.json'), 'utf8'),
        );
        if (
          metadata &&
          typeof metadata === 'object' &&
          'name' in metadata &&
          metadata.name === '@locker/near-membrane-dom' &&
          'version' in metadata
        ) {
          const compiled = await bundle('@locker/near-membrane-dom', 'esm');
          membrane = {
            installed: true,
            version: metadata.version,
            entry: '@locker/near-membrane-dom (browser import resolution)',
            ...compiled.measurement,
            reachable: await reachable([compiled.metafile]),
          };
          break;
        }
      } catch (error) {
        if (dirname(packageDirectory) === packageDirectory) throw error;
      }
      const parent = dirname(packageDirectory);
      if (parent === packageDirectory)
        throw new Error('Membrane package metadata missing');
      packageDirectory = parent;
    }
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      error.code !== 'MODULE_NOT_FOUND'
    )
      throw error;
  }
  console.log(
    JSON.stringify(
      {
        revision: commit,
        measuredAt: new Date().toISOString(),
        node: process.version,
        esbuild: require('esbuild/package.json').version,
        method: {
          source:
            'Unique reachable input files counted whole, including tree-shaken parts.',
          emitted: 'Production build settings, unminified, fixed measurement build ID.',
          dependencies:
            'Resolved from this worktree node_modules; record lock digest below.',
          duplication:
            'Reachable source is deduplicated; emitted bundles include deployment duplication.',
          membrane:
            'Separate candidate bundle; do not add it to final totals without deduplicating shared inputs.',
        },
        installedLockSHA256: createHash('sha256')
          .update(await readFile(join(root, 'package-lock.json')))
          .digest('hex'),
        historicalLockSHA256: createHash('sha256')
          .update(await readFile(join(directory, 'package-lock.json')))
          .digest('hex'),
        runtime: {
          source: { total: total(runtimeFiles), files: runtimeFiles },
          reachable: await reachable(builds.map((item) => item.metafile)),
          bundles: Object.fromEntries(
            builds.map((item) => [item.name, item.measurement]),
          ),
        },
        installation: {
          source: { total: total(installationFiles), files: installationFiles },
          reachable: await reachable([installer.metafile]),
          bundle: installer.measurement,
        },
        membrane,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
