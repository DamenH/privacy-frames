import { launch } from './browser-profile.ts';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import { servers } from './server.ts';
const server = await servers(),
  results = [];
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine),
      context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
      });
    context.setDefaultTimeout(30000);
    const row = { name, checks: [] };
    results.push(row);
    try {
      const page = await context.newPage();
      await page.goto('http://127.0.0.1:4210/privacy-frames/');
      await page.getByText('Ready to install.', { exact: true }).waitFor();
      assert.equal(context.pages().length, 1);
      assert.equal(await page.locator('#connect-runtime').count(), 0);
      assert(await page.evaluate(() => document.body.scrollWidth <= innerWidth));
      await page.locator('#app-url').fill('http://127.0.0.1:4212/');
      await page.locator('#install button').tap();
      await page.locator('[data-app="notes"]').waitFor();
      assert.equal(context.pages().length, 1);
      row.checks.push(
        'Mobile-sized installation has no connection tab or horizontal overflow',
      );
      const opened = context.waitForEvent('page');
      await page.locator('[data-app="notes"]').tap();
      const app = await opened;
      await app.waitForFunction(() =>
        document.querySelector('#mode')?.textContent.includes('network isolated'),
      );
      assert.equal(await app.evaluate(() => window.opener), null);
      row.checks.push('Explicit Open launches a confined app without an opener');
      await app.close();
      await context.close();
      const denied = await browser.newContext({ viewport: { width: 390, height: 844 } });
      denied.setDefaultTimeout(30000);
      try {
        await denied.addInitScript(() => {
          if (location.pathname.endsWith('/connect.html')) {
            Object.defineProperty(indexedDB, 'databases', {
              value: () =>
                Promise.reject(
                  new DOMException('Synthetic storage denial', 'SecurityError'),
                ),
            });
            Object.defineProperty(document, 'requestStorageAccess', {
              value: () =>
                Promise.reject(
                  new DOMException('Synthetic permission denial', 'NotAllowedError'),
                ),
            });
          }
        });
        const manager = await denied.newPage();
        await manager.goto('http://127.0.0.1:4210/privacy-frames/');
        const frame = manager.frameLocator('#runtime-bridge');
        await frame.locator('#reconnect').waitFor({ state: 'visible' });
        await frame.locator('#reconnect').click();
        await manager.waitForFunction(() =>
          document
            .querySelector('#status')
            .textContent.includes('Synthetic permission denial'),
        );
        assert.equal(denied.pages().length, 1);
        assert.equal(await manager.locator('[data-installation]').count(), 0);
        row.checks.push(
          'Denied storage permission reports failure without opening a tab or admitting an app',
        );
      } finally {
        await denied.close();
      }
    } catch (error) {
      row.failure = error.stack;
      throw error;
    } finally {
      await context.close();
      await browser.close();
    }
  }
} finally {
  await server.close();
  await writeFile(
    new URL('../results/mobile.json', import.meta.url),
    JSON.stringify(results, null, 2) + '\n',
  );
}
console.log(
  results
    .map((r) => `${r.name}: ${r.checks.length} mobile-layout/permission groups passed`)
    .join('\n'),
);
