import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';
import { servers } from './server.ts';

const server = await servers();
const results = [];
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    try {
      const context = await browser.newContext();
      context.setDefaultTimeout(20000);
      const manager = await context.newPage();
      await manager.goto('http://127.0.0.1:4210/privacy-frames/');
      await manager.getByText('Ready to install.', { exact: true }).waitFor();
      await manager.locator('#app-url').fill('http://127.0.0.1:4212/');
      await manager.locator('#install button').click();
      const link = manager.locator('[data-app="notes"]');
      await link.waitFor();
      const opened = context.waitForEvent('page');
      await link.click();
      const app = await opened;
      await app.locator('#note').fill('synthetic lifecycle note');
      await app.locator('#save').click();
      const bridge = manager
        .frames()
        .find((frame) => frame.url().endsWith('/connect.html'))!;
      // A trusted bridge, never application code, requests controller replacement.
      const scriptURL = await bridge.evaluate(async () => {
        const registration = await navigator.serviceWorker.register('sw.js?lifecycle=1', {
          scope: './',
          updateViaCache: 'none',
        });
        await new Promise<void>((resolve, reject) => {
          const deadline = setTimeout(
            () => reject(new Error('Worker replacement timed out')),
            15000,
          );
          const check = () => {
            if (navigator.serviceWorker.controller?.scriptURL.endsWith('?lifecycle=1')) {
              clearTimeout(deadline);
              navigator.serviceWorker.removeEventListener('controllerchange', check);
              resolve();
            }
          };
          navigator.serviceWorker.addEventListener('controllerchange', check);
          check();
          registration.update().catch(reject);
        });
        return navigator.serviceWorker.controller!.scriptURL;
      });
      assert(scriptURL.endsWith('?lifecycle=1'));
      await app.reload({ waitUntil: 'commit' });
      await app.locator('#note').waitFor();
      assert.equal(await app.locator('#note').inputValue(), 'synthetic lifecycle note');
      const blocked = await app.evaluate(async () => {
        try {
          await fetch('http://127.0.0.1:4366/lifecycle-private-marker');
          return false;
        } catch {
          return true;
        }
      });
      assert(blocked);
      assert(
        !server.traffic.some((entry) => entry.path.includes('lifecycle-private-marker')),
      );
      await app.close();
      await manager.reload();
      await manager.locator('[data-app="notes"]').waitFor();
      results.push({
        name,
        version: browser.version(),
        replacementScript: scriptURL,
        persistedNote: true,
        receiverRequests: 0,
        managementAfterReplacement: true,
      });
      await context.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
  await mkdir(new URL('../results/evaluation/', import.meta.url), { recursive: true });
  await writeFile(
    new URL('../results/evaluation/lifecycle.json', import.meta.url),
    JSON.stringify(results, null, 2) + '\n',
  );
}
console.log(
  'Worker replacement preserves confinement, saved state and management in both browsers.',
);
