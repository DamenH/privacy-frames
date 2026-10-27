import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');

/** Tests use a pinned publisher checkout; publisher code never enters trusted output. */
export async function buildExamples() {
  const revision = (
    await readFile(resolve(root, 'publisher-source-ref.txt'), 'utf8')
  ).trim();
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Invalid publisher source pin');
  const source = resolve(
    process.env.PUBLISHER_SOURCE || resolve(root, 'publisher-source'),
  );
  const run = (command: string, args: string[]) =>
    execFileSync(command, args, { cwd: source, stdio: 'inherit' });
  if (!existsSync(source)) {
    execFileSync(
      'git',
      ['clone', '--no-checkout', 'https://github.com/privacy-frames/apps.git', source],
      { stdio: 'inherit' },
    );
    run('git', ['fetch', '--depth=1', 'origin', revision]);
    run('git', ['checkout', '--detach', revision]);
  }
  const actual = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: source,
    encoding: 'utf8',
  }).trim();
  if (actual !== revision)
    throw new Error('Publisher checkout differs from publisher-source-ref.txt');
  const lockHash = createHash('sha256')
    .update(await readFile(resolve(source, 'package-lock.json')))
    .digest('hex');
  const stamp = resolve(source, 'node_modules/.pf-lock-hash');
  if (!existsSync(stamp) || (await readFile(stamp, 'utf8')) !== lockHash) {
    run('npm', ['ci']);
    await writeFile(stamp, lockHash);
  }
  run('npm', ['run', 'build:examples', '--', '--output', resolve(root, 'dist-examples')]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await buildExamples();
}
