import { launch } from './browser-profile.ts';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import { servers } from './server.ts';
const server = await servers(),
  results = [];
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(
        engine,
        name === 'chromium' ? { executablePath: chromium.executablePath() } : {},
      ),
      context = await browser.newContext(),
      manager = await context.newPage();
    const checks = [],
      errors = [];
    let app;
    try {
      await manager.goto('http://127.0.0.1:4210/privacy-frames/');
      await manager.locator('#refresh-apps').waitFor();
      await manager.getByText('Ready to install.', { exact: true }).waitFor();
      await manager.evaluate(() => {
        localStorage.setItem('private-manager-data', 'synthetic-canary');
      });
      await manager.locator('#app-url').fill('http://127.0.0.1:4218/');
      await manager.locator('#install button').click();
      await manager.waitForFunction(() =>
        /^(Installed |Installation refused:)/.test(
          document.querySelector('#status').textContent,
        ),
      );
      assert.match(await manager.locator('#status').textContent(), /^Installed /);
      assert.equal(manager.workers().length, 0, 'Preparation worker survived completion');
      assert.equal(
        await manager.evaluate(() => localStorage.getItem('private-manager-data')),
        'synthetic-canary',
      );
      checks.push(
        'No-manifest website installation completes with no native browser authority in publisher install code and no surviving preparation worker',
      );
      const opened = context.waitForEvent('page');
      await manager.locator('[data-app="ordinary"]').click();
      app = await opened;
      app.on('pageerror', (e) => errors.push(e.message));
      await app
        .getByText('Imported module: prepared; activated', { exact: true })
        .waitFor();
      assert(
        Object.values(
          await app.evaluate(
            async () => (await (await fetch('/phase.json')).json()).authority,
          ),
        ).every((value) => value === false),
      );
      const externalStart = server.traffic.length;
      await app.locator('#private').fill('private-website-marker-' + name);
      await app.locator('#send').click();
      await app.getByText('Network blocked', { exact: true }).waitFor();
      assert.deepEqual(
        server.traffic
          .slice(externalStart)
          .filter((r) => r.path.includes('private-website-marker')),
        [],
      );
      assert.equal(app.workers().length, 0);
      checks.push(
        'Root-relative CSS/resources, relative module imports and generated cache content work; private execution has no publisher worker or network fallback',
      );
      const authority = await app.evaluate(async () => {
        const ready = await navigator.serviceWorker.ready;
        const results = [];
        for (const operation of [
          () => navigator.serviceWorker.register('/other-worker.js'),
          () => ready.update(),
          () => ready.unregister(),
          () => ready.navigationPreload.enable(),
          () => ready.active.postMessage({ operation: 'list' }),
        ]) {
          try {
            await operation();
            results.push(false);
          } catch {
            results.push(true);
          }
        }
        return results;
      });
      assert.deepEqual(authority, [true, true, true, true, true]);
      await context.setOffline(true);
      await app.reload();
      await app
        .getByText('Imported module: prepared; activated', { exact: true })
        .waitFor();
      await context.setOffline(false);
      await app.close();
      checks.push(
        'Mediated registration cannot enable updates, alternate workers, messaging or navigation preload; offline fresh document works',
      );
      await manager.locator('#app-url').fill('http://127.0.0.1:4218/reject/');
      await manager.locator('#install button').click();
      await manager.locator('[data-app="reject"]').waitFor();
      assert.match(await manager.locator('#status').textContent(), /^Installed /);
      assert.equal(await manager.locator('.app-card').count(), 2);
      assert.equal(manager.workers().length, 0);
      const bridge = manager
        .frames()
        .find((frame) => frame.url().endsWith('/connect.html'));
      assert(bridge);
      const discarded = await bridge.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('privacy-frames-installations', 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          const records: unknown = await new Promise((resolve, reject) => {
            const request = database
              .transaction('installations')
              .objectStore('installations')
              .getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          if (!Array.isArray(records)) throw new Error('Invalid installation records');
          const record = records.find(
            (value) => value.source === 'http://127.0.0.1:4218/reject/',
          );
          if (!record) throw new Error('Static fallback installation is missing');
          return record.preparation;
        } finally {
          database.close();
        }
      });
      assert.equal(discarded.outcome.status, 'failed');
      assert.match(discarded.outcome.reason, /Installation deliberately rejected/);
      assert.equal(discarded.serviceWorker, null);
      assert.deepEqual(discarded.caches, []);
      checks.push(
        'Rejected optional preparation terminates and publishes only the independent static graph, with no successful worker receipt or caches',
      );
      await manager.locator('#app-url').fill('http://127.0.0.1:4212/broken/');
      await manager.locator('#install button').click();
      await manager.waitForFunction(() =>
        document.querySelector('#status').textContent.startsWith('Installation refused:'),
      );
      assert.equal(await manager.locator('.app-card').count(), 2);
      assert.equal(manager.workers().length, 0);
      checks.push('Missing independently declared resources still refuse installation');
      assert.deepEqual(errors, []);
      results.push({ name, version: browser.version(), checks });
    } catch (error) {
      results.push({
        name,
        checks,
        errors,
        status: await manager.locator('#status').textContent(),
        failure: error.stack,
      });
      throw error;
    } finally {
      await context.close();
      await browser.close();
    }
  }
} finally {
  await server.close();
  await writeFile(
    new URL('../results/website-installation.json', import.meta.url),
    JSON.stringify(results, null, 2) + '\n',
  );
}
console.log(
  results
    .map((r) => `${r.name}: ${r.checks.length} website-installation groups passed`)
    .join('\n'),
);
