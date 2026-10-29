import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';
import { servers } from './server.ts';

async function workerProbe({ source, marker }: { source: string; marker: string }) {
  const labelURL = new URL('../wasm-label.js', source).href;
  const wasmURL = new URL('./answer.wasm', source).href;
  const code = `import { label } from ${JSON.stringify(labelURL)};
    let blocked = false;
    try { await fetch(${JSON.stringify('http://127.0.0.1:4366/worker-disclosure?value=' + encodeURIComponent(marker))}); }
    catch { blocked = true; }
    const result = await WebAssembly.instantiateStreaming(fetch(${JSON.stringify(wasmURL)}), {});
    postMessage({ answer: label(result.instance.exports.answer()), mode: globalThis.privacyHost?.mode || 'native', blocked });`;
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  const worker = new Worker(url, { type: 'module' });
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Wasm worker timed out')), 15000);
      worker.onmessage = (event) => {
        clearTimeout(timer);
        resolve(event.data);
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        reject(new Error(event.message));
      };
    });
  } finally {
    worker.terminate();
    URL.revokeObjectURL(url);
  }
}

const hostURL = process.env.HOST_URL || 'http://127.0.0.1:4210/privacy-frames/';
const deployed = !!process.env.HOST_URL;
const server = deployed ? { traffic: [], close: async () => {} } : await servers();
const fixture = process.env.WASM_FIXTURE_URL || 'http://127.0.0.1:4218/wasm/index.html';
const results = [];
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    const context = await browser.newContext();
    const row = {
      name,
      version: browser.version(),
      host: hostURL,
      checks: [],
      installations: [],
    };
    results.push(row);
    try {
      const manager = await context.newPage();
      await manager.goto(hostURL);
      await manager.getByText('Ready to install.', { exact: true }).waitFor();
      const start = server.traffic.length;
      async function install(url: string) {
        await manager.locator('#app-url').fill(url);
        const resourceListUsed = (await manager.locator('#resource-list-url').count())
          ? await manager.locator('#resource-list-url').inputValue()
          : null;
        const installationStarted = performance.now();
        try {
          await manager.locator('#install button').click();
          await manager.waitForFunction(
            () =>
              /^(Installed |Installation refused:)/.test(
                document.querySelector('#status')?.textContent || '',
              ),
            undefined,
            { timeout: 120000 },
          );
        } finally {
          row.installations.push({
            url,
            resourceListUsed,
            installationElapsedMs: performance.now() - installationStarted,
          });
        }
        const status = await manager.locator('#status').textContent();
        assert(status?.startsWith('Installed '), status);
        return status;
      }
      await install(fixture);
      await manager.locator('[data-app="wasm"]').waitFor();
      assert(
        !server.traffic.slice(start).some((request) => request.path.includes('app.json')),
      );
      const opened = context.waitForEvent('page');
      await manager.locator('[data-app="wasm"]').click();
      const app = await opened;
      app.on('console', (message) => {
        if (
          message.type() === 'error' &&
          message.text().includes('Worker startup failed:')
        )
          console.error(message.text());
      });
      await app.getByText('Answer: 42', { exact: true }).waitFor();
      if (!deployed) {
        const control = await context.newPage();
        await control.goto(fixture);
        const native = await control.evaluate(workerProbe, {
          source: fixture,
          marker: `native-wasm-${name}`,
        });
        assert.deepEqual(native, { answer: '42', mode: 'native', blocked: false });
        await control.close();
      }
      row.checks.push(
        'Initial inline module, preload Wasm and transitive relocated import execute',
      );
      await context.setOffline(true);
      await app.reload({ waitUntil: 'commit' });
      await app.getByText('Answer: 42', { exact: true }).waitFor();
      row.checks.push('Wasm instantiation and module graph work offline');
      await context.setOffline(false);
      const before = server.traffic.length;
      await app.locator('#private').fill(`private-wasm-${name}`);
      await app.locator('#send').click();
      await app.getByText('Network blocked', { exact: true }).waitFor();
      assert(
        !server.traffic
          .slice(before)
          .some((request) => request.path.includes('private-wasm')),
      );
      const workerResult = await app.evaluate(workerProbe, {
        source: fixture,
        marker: `private-wasm-${name}`,
      });
      assert.deepEqual(workerResult, {
        answer: '42',
        mode: 'network-isolated',
        blocked: true,
      });
      assert(
        !server.traffic
          .slice(before)
          .some((request) => request.path.includes('private-wasm')),
      );
      row.checks.push(
        deployed
          ? 'Prepared module worker computes the Wasm result and rejects disclosure; receiver evidence is measured locally'
          : 'Prepared module worker computes the Wasm result; private markers remain absent at receiver',
      );
      await app.close();
      if (process.env.EXTERNAL_WASM_URL) {
        const message = await install(process.env.EXTERNAL_WASM_URL);
        const popup = context.waitForEvent('page');
        const appName = message.slice('Installed '.length, -1);
        await manager
          .locator('.app-card')
          .filter({ has: manager.getByRole('heading', { name: appName, exact: true }) })
          .getByRole('link', { name: 'Open', exact: true })
          .click();
        const external = await popup;
        const errors = [];
        external.on('pageerror', (error) => errors.push(error.message));
        await external.waitForFunction(
          () =>
            document.querySelector('#photocraft_loading') === null &&
            document.querySelector('canvas')?.width > 0,
          {},
          { timeout: 120000 },
        );
        await external.screenshot({ path: `/tmp/pf-independent-wasm-${name}.png` });
        row.checks.push('Independent Wasm application installs and renders its canvas');
        assert(!errors.length, errors.join('\n'));
        await context.setOffline(true);
        await external.reload({ waitUntil: 'commit' });
        await external.waitForFunction(
          () =>
            document.querySelector('#photocraft_loading') === null &&
            document.querySelector('canvas')?.width > 0,
          {},
          { timeout: 120000 },
        );
        row.checks.push('Independent Wasm application starts offline');
      }
    } finally {
      await context.close();
      await browser.close();
    }
  }
} finally {
  await server.close();
  await writeFile(
    deployed ? 'results/wasm-deployed.json' : 'results/wasm.json',
    JSON.stringify(results, null, 2) + '\n',
  );
}
console.log(results);
