import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';
import { servers } from './server.ts';

const hostURL = process.env.HOST_URL || 'http://127.0.0.1:4210/privacy-frames/';
const deployed = !!process.env.HOST_URL;
const server = deployed ? { traffic: [], close: async () => {} } : await servers();
const fixture = process.env.WASM_FIXTURE_URL || 'http://127.0.0.1:4218/wasm/index.html';
const results = [];
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    const context = await browser.newContext();
    const row = { name, version: browser.version(), host: hostURL, checks: [] };
    results.push(row);
    try {
      const manager = await context.newPage();
      await manager.goto(hostURL);
      await manager.getByText('Ready to install.', { exact: true }).waitFor();
      const start = server.traffic.length;
      await manager.locator('#app-url').fill(fixture);
      await manager.locator('#install button').click();
      await manager.locator('[data-app="wasm"]').waitFor();
      assert(
        !server.traffic.slice(start).some((request) => request.path.includes('app.json')),
      );
      const opened = context.waitForEvent('page');
      await manager.locator('[data-app="wasm"]').click();
      const app = await opened;
      await app.getByText('Answer: 42', { exact: true }).waitFor();
      row.checks.push(
        'Initial inline module, preload Wasm and transitive relocated import execute',
      );
      await context.setOffline(true);
      await app.reload();
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
      assert(
        await app.evaluate(() => {
          try {
            new Worker('module.js');
            return false;
          } catch {
            return true;
          }
        }),
      );
      row.checks.push(
        'Private network marker absent at receiver; native workers remain refused',
      );
      await app.close();
      if (process.env.EXTERNAL_WASM_URL) {
        await manager.locator('#app-url').fill(process.env.EXTERNAL_WASM_URL);
        await manager.locator('#install button').click();
        await manager.waitForFunction(
          () =>
            /^(Installed |Installation refused:)/.test(
              document.querySelector('#status').textContent,
            ),
          {},
          { timeout: 120000 },
        );
        const message = await manager.locator('#status').textContent();
        assert(message.startsWith('Installed '), message);
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
        await external.reload();
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
