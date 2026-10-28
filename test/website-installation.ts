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
      checks.push(
        'Root-relative resources, module imports and generated cache content work without network fallback',
      );
      const runtimeBridgeRealm = manager
        .frames()
        .find((frame) => frame.url().endsWith('/connect.html'));
      assert(runtimeBridgeRealm);
      const nativeState = () =>
        runtimeBridgeRealm.evaluate(async () => ({
          controller: navigator.serviceWorker.controller?.scriptURL,
          registrations: (await navigator.serviceWorker.getRegistrations())
            .map((registration) => ({
              scope: registration.scope,
              active: registration.active?.scriptURL,
              state: registration.active?.state,
            }))
            .sort((left, right) => left.scope.localeCompare(right.scope)),
        }));
      const before = await nativeState();
      assert(before.controller?.endsWith('/runtime/sw.js'));
      assert.equal(before.registrations.length, 1);
      assert.equal(before.registrations[0].state, 'activated');
      const httpControlStart = server.traffic.length;
      const httpControl = await manager.evaluate(async () => {
        const marker = 'native-receiver-' + crypto.randomUUID();
        const response = await fetch('http://127.0.0.1:4366/disclosure?marker=' + marker);
        return { marker, status: response.status, body: await response.text() };
      });
      assert.equal(httpControl.status, 200);
      assert.equal(httpControl.body, 'diagnostic receiver');
      assert.equal(
        server.traffic
          .slice(httpControlStart)
          .filter((request) => request.path.includes(httpControl.marker)).length,
        1,
        'Native HTTP receiver control was inactive',
      );
      const nativeListControl = await runtimeBridgeRealm.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const channel = new MessageChannel();
            const timeout = setTimeout(
              () => reject(new Error('Native list control timed out')),
              5000,
            );
            channel.port1.onmessage = (event) => {
              clearTimeout(timeout);
              channel.port1.close();
              resolve(event.data);
            };
            navigator.serviceWorker.controller!.postMessage({ operation: 'list' }, [
              channel.port2,
            ]);
          }),
      );
      assert.equal(nativeListControl.ok, true);
      assert.equal(nativeListControl.value.length, 1);
      const authority = await app.evaluate(async () => {
        const ready = await navigator.serviceWorker.ready;
        const prohibited = [];
        for (const operation of [
          () => navigator.serviceWorker.register('/other-worker.js'),
          () => ready.update(),
          () => ready.navigationPreload.enable(),
        ]) {
          try {
            await operation();
            prohibited.push(false);
          } catch {
            prohibited.push(true);
          }
        }
        const virtualReplies = await new Promise<unknown[]>((resolve) => {
          const channel = new MessageChannel();
          const replies: unknown[] = [];
          channel.port1.onmessage = (event) => replies.push(event.data);
          ready.active!.postMessage({ operation: 'list' }, [channel.port2]);
          setTimeout(() => {
            channel.port1.close();
            resolve(replies);
          }, 750);
        });
        return { prohibited, virtualReplies, unregistered: await ready.unregister() };
      });
      assert.deepEqual(authority.prohibited, [true, true, true]);
      assert.deepEqual(
        authority.virtualReplies,
        [],
        'Virtual messaging reached host management',
      );
      assert.equal(typeof authority.unregistered, 'boolean');
      assert.equal(authority.unregistered, true);
      assert.deepEqual(
        await nativeState(),
        before,
        'Virtual unregister changed native worker authority',
      );
      const unregisterStart = server.traffic.length;
      const afterUnregister = await app.evaluate(async () => {
        const marker = 'post-unregister-' + crypto.randomUUID();
        const outcomes = [];
        for (const url of [
          new URL('__private-not-installed?marker=' + marker, location.href).href,
          'http://127.0.0.1:4366/disclosure?marker=' + marker,
        ]) {
          try {
            const response = await fetch(url);
            outcomes.push(!response.ok);
          } catch {
            outcomes.push(true);
          }
        }
        return { marker, outcomes, mode: window.privacyHost?.mode };
      });
      assert.deepEqual(afterUnregister.outcomes, [true, true]);
      assert.equal(afterUnregister.mode, 'network-isolated');
      await app.waitForTimeout(250);
      const escapedAfterUnregister = server.traffic
        .slice(unregisterStart)
        .filter((request) => request.path.includes(afterUnregister.marker));
      assert.deepEqual(
        escapedAfterUnregister,
        [],
        'Post-unregister request reached HTTP receiver',
      );
      await context.setOffline(true);
      await app.reload({ waitUntil: 'commit' });
      await app
        .getByText('Imported module: prepared; activated', { exact: true })
        .waitFor();
      assert.equal(
        await app.evaluate(() => window.privacyHost?.mode),
        'network-isolated',
      );
      await app.close();
      const relaunched = context.waitForEvent('page');
      await manager.locator('[data-app="ordinary"]').click();
      app = await relaunched;
      await app
        .getByText('Imported module: prepared; activated', { exact: true })
        .waitFor();
      assert.equal(
        await app.evaluate(() => window.privacyHost?.mode),
        'network-isolated',
      );
      await context.setOffline(false);
      await app.close();
      checks.push(
        'Virtual messaging cannot list host installations; virtual unregister preserves native registration/control and blocked unknown requests; offline reload and relaunch remain confined',
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
      await manager.locator('#app-url').fill('http://127.0.0.1:4212/missing-entry.html');
      await manager.locator('#install button').click();
      await manager.waitForFunction(() =>
        document.querySelector('#status').textContent.startsWith('Installation refused:'),
      );
      assert.equal(await manager.locator('.app-card').count(), 2);
      assert.equal(manager.workers().length, 0);
      checks.push(
        'Missing entry document refuses installation without publishing a record',
      );
      assert.deepEqual(errors, []);
      results.push({
        name,
        version: browser.version(),
        checks,
        authority,
        nativeBefore: before,
        nativeAfter: await nativeState(),
        afterUnregister,
        escapedAfterUnregister,
        httpControl,
      });
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
