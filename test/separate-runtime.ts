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
      context = await browser.newContext(),
      manager = await context.newPage();
    const checks = [];
    let errors = [];
    try {
      manager.on('pageerror', (e) => errors.push(e.message));
      await manager.goto('http://127.0.0.1:4210/privacy-frames/');
      await manager.locator('#refresh-apps').waitFor();
      await manager.evaluate(() =>
        localStorage.setItem('manager-secret', 'synthetic-manager-canary'),
      );
      await manager.getByText('Ready to install.', { exact: true }).waitFor();
      const installer = manager
        .frames()
        .find((frame) => frame.url().endsWith('/connect.html'));
      assert(installer);
      assert.equal(context.pages().length, 1);
      assert.equal(new URL(installer.url()).hostname, '127.0.0.1');
      checks.push('Same-site cross-origin iframe connects without a popup');
      await manager.locator('#app-url').fill('http://127.0.0.1:4212/');
      await manager.locator('#install button').click();
      const launch = manager.locator('[data-app="notes"]');
      await launch.waitFor();
      assert.match(
        await launch.getAttribute('href'),
        /^http:\/\/127\.0\.0\.1:4211\/runtime\/[A-Za-z0-9_-]{11}\/notes\/$/,
      );
      const appOpened = context.waitForEvent('page');
      await launch.click();
      const app = await appOpened;
      app.on('pageerror', (e) => errors.push(e.message));
      await app.waitForFunction(() =>
        document.querySelector('#mode')?.textContent.includes('network isolated'),
      );
      await app.locator('#note').fill('private-local-notes');
      await app.locator('#save').click();
      assert.equal(
        await app.evaluate(() => localStorage.getItem('manager-secret')),
        null,
      );
      assert.equal(await app.evaluate(() => window.opener), null);
      await app.reload();
      await app.waitForFunction(() =>
        document.querySelector('#mode')?.textContent.includes('network isolated'),
      );
      assert.equal(await app.locator('#note').inputValue(), 'private-local-notes');
      checks.push(
        'Readable source-bound URL, scoped persistence and separate manager storage',
      );
      await app.close();
      await manager.reload();
      await manager.locator('[data-app="notes"]').waitFor();
      assert.equal(await manager.locator('iframe').count(), 1);
      const reopened = context.waitForEvent('page');
      await manager.locator('[data-app="notes"]').click();
      const offline = await reopened;
      await offline.waitForFunction(() =>
        document.querySelector('#mode')?.textContent.includes('network isolated'),
      );
      await context.setOffline(true);
      await offline.reload();
      await offline.waitForFunction(() =>
        document.querySelector('#mode')?.textContent.includes('network isolated'),
      );
      assert.equal(await offline.locator('#note').inputValue(), 'private-local-notes');
      await context.setOffline(false);
      await offline.close();
      checks.push('Cached manager library launches installed application offline');
      // A genuine same-runtime document embedded by a publisher must not accept
      // that publisher as its manager, even though it can load the bridge URL.
      const outsider = await context.newPage();
      await outsider.goto('http://127.0.0.1:4212/');
      const impersonation = await outsider.evaluate(async () => {
        const frame = document.createElement('iframe');
        frame.src = 'http://127.0.0.1:4211/runtime/connect.html';
        document.body.append(frame);
        await new Promise((resolve) => (frame.onload = resolve));
        return await new Promise((resolve) => {
          const channel = new MessageChannel();
          channel.port1.onmessage = (e) => {
            channel.port1.close();
            resolve(e.data.type);
          };
          frame.contentWindow.postMessage(
            { type: 'pf-connect' },
            'http://127.0.0.1:4211',
            [channel.port2],
          );
          setTimeout(() => {
            channel.port1.close();
            resolve('no authority');
          }, 400);
        });
      });
      assert.equal(impersonation, 'no authority');
      await outsider.close();
      checks.push('A publisher parent cannot authenticate to a real runtime bridge');
      const bridge = manager
        .frames()
        .find((frame) => frame.url().endsWith('/connect.html'));
      const custom = await bridge.evaluate(async () => {
        const source = 'https://publisher.test/non-index/',
          digest = async (bytes) =>
            Array.from(
              new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
              (byte) => byte.toString(16).padStart(2, '0'),
            ).join('');
        const manifest = {
            id: 'custom-entry',
            name: 'Custom entry',
            entry: 'launch.html',
          },
          resources = [];
        for (const [path, text] of [
          [
            'launch.html',
            '<!doctype html><p id="result">Loading</p><script src="./app.js"></script>',
          ],
          [
            'app.js',
            'document.querySelector("#result").textContent=privacyHost.mode;if(parent!==window)parent.postMessage({type:"embedded-leak",secret:localStorage.getItem("embedding-canary")},"*");',
          ],
        ]) {
          const bytes = new TextEncoder().encode(text).buffer;
          resources.push({
            path,
            url: new URL(path, source).href,
            contentType: path.endsWith('.html') ? 'text/html' : 'text/javascript',
            bytes,
            sha256: await digest(bytes),
          });
        }
        const pkg = {
          id: manifest.id + '-' + (await digest(new TextEncoder().encode(source))),
          manifest,
          source,
          resources,
          preparation: {
            profile: 'website-v1',
            outcome: { status: 'absent' },
            ended: true,
            caches: [],
            serviceWorker: null,
          },
        };
        return new Promise((resolve) => {
          const channel = new MessageChannel();
          channel.port1.onmessage = (e) => resolve(e.data);
          navigator.serviceWorker.controller.postMessage(
            { operation: 'install', payload: pkg },
            [channel.port2],
          );
        });
      });
      assert.equal(custom.ok, true, JSON.stringify(custom));
      await manager.locator('#refresh-apps').click();
      await manager.locator('[data-app="custom-entry"]').waitFor();
      const customURL = await manager
        .locator('[data-app="custom-entry"]')
        .getAttribute('href');
      assert(!customURL.includes('launch.html'));
      const customPage = await context.newPage();
      const wrong = new URL(customURL);
      wrong.pathname = wrong.pathname.replace('/custom-entry/', '/wrong/');
      wrong.hash = '/reference';
      await customPage.goto(wrong.href);
      await customPage.getByText('network-isolated', { exact: true }).waitFor();
      assert.equal(new URL(customPage.url()).pathname, new URL(customURL).pathname);
      assert.equal(new URL(customPage.url()).hash, '#/reference');
      await customPage.evaluate(() =>
        localStorage.setItem('embedding-canary', 'private-embedding-canary'),
      );
      await customPage.close();
      checks.push(
        'Non-index entry is hidden and a wrong label redirects without losing the app fragment',
      );
      const attacker = await context.newPage();
      await attacker.goto('http://127.0.0.1:4212/');
      const embedding = await attacker.evaluate(async (url) => {
        const received = [];
        addEventListener('message', (event) => received.push(event.data));
        const control = document.createElement('iframe');
        control.srcdoc =
          '<script>parent.postMessage({type:"embedding-control"},"*")<\/script>';
        document.body.append(control);
        const frame = document.createElement('iframe');
        frame.src = url;
        document.body.append(frame);
        await new Promise((resolve) => setTimeout(resolve, 500));
        return {
          control: received.some((value) => value?.type === 'embedding-control'),
          leaks: received.filter((value) => value?.type === 'embedded-leak'),
        };
      }, customURL);
      assert.equal(embedding.control, true);
      assert.deepEqual(embedding.leaks, []);
      await attacker.close();
      checks.push(
        'External embedding cannot run a private-state disclosure script; unrestricted frame control works',
      );
      const installedId = await manager
        .locator('[data-app="notes"]')
        .getAttribute('data-installation');
      await bridge.evaluate(async (id) => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('privacy-frames-installations', 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        await new Promise((resolve, reject) => {
          const tx = db.transaction('installations', 'readwrite'),
            store = tx.objectStore('installations'),
            read = store.get(id);
          read.onsuccess = () =>
            store.put({ ...read.result, id: 'collision-' + id.slice(-64) });
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
        db.close();
      }, installedId);
      await manager.locator('#app-url').fill('http://127.0.0.1:4212/');
      await manager.locator('#install button').click();
      await manager
        .getByText('Installation refused: Installation alias collision', { exact: true })
        .waitFor();
      await bridge.evaluate(async (id) => {
        const db = await new Promise((resolve) => {
          const request = indexedDB.open('privacy-frames-installations', 1);
          request.onsuccess = () => resolve(request.result);
        });
        await new Promise((resolve) => {
          const tx = db.transaction('installations', 'readwrite');
          tx.objectStore('installations').delete('collision-' + id.slice(-64));
          tx.oncomplete = resolve;
        });
        db.close();
      }, installedId);
      checks.push(
        'A forced 64-bit alias collision refuses installation without overwriting an app',
      );
      assert.deepEqual(errors, []);
      results.push({ name, version: browser.version(), checks });
    } catch (error) {
      results.push({ name, checks, errors, failure: error.stack });
      throw error;
    } finally {
      await context.close();
      await browser.close();
    }
  }
} finally {
  await server.close();
  await writeFile(
    new URL('../results/separate-runtime.json', import.meta.url),
    JSON.stringify(results, null, 2) + '\n',
  );
}
console.log(
  results
    .map((r) => `${r.name}: ${r.checks.length} separate-runtime groups passed`)
    .join('\n'),
);
