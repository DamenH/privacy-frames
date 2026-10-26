import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('configuration changes invalidate bootstrap and role builds expose only their entry points', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'privacy-frames-build-'));
  const configuration = join(temporary, 'configuration.json');
  const output = join(temporary, 'output');
  async function build(role: 'manager' | 'runtime', publisher: string) {
    await writeFile(
      configuration,
      JSON.stringify({
        managerURL: 'https://manager.test/',
        runtimeURL: 'https://runtime.test/',
        managerOrigins: ['https://manager.test'],
        examples: [{ name: 'Example', url: publisher }],
      }),
    );
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build.ts'], {
      cwd: new URL('../', import.meta.url),
      env: {
        ...process.env,
        HOST_ROLE: role,
        HOST_CONFIG: configuration,
        BUILD_DIRECTORY: output,
      },
      stdio: 'pipe',
    });
    return readFile(join(output, 'sw.js'), 'utf8');
  }
  try {
    const first = await build('manager', 'https://first.example/');
    const second = await build('manager', 'https://second.example/');
    assert.notEqual(first, second);
    await access(join(output, 'manager.js'));
    await assert.rejects(access(join(output, 'guard.js')));
    const runtime = await build('runtime', 'https://second.example/');
    assert.notEqual(second, runtime);
    await access(join(output, 'guard.js'));
    await access(join(output, 'connect.html'));
    await assert.rejects(access(join(output, 'manager.js')));
    await assert.rejects(access(join(output, 'adversary/index.html')));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
