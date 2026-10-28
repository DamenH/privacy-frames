import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';
import { servers } from './server.ts';
import type { Installation } from '../src/shared/types.ts';

async function registrationStatus() {
  return {
    registrations: (await navigator.serviceWorker.getRegistrations()).length,
    registered: (await navigator.serviceWorker.getRegistration()) !== undefined,
    readyWithin250ms: await Promise.race([
      navigator.serviceWorker.ready.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 250)),
    ]),
  };
}

function historyCoercion() {
  const original = location.href;
  let conversions = 0;
  history.replaceState(null, '', {
    toString() {
      conversions++;
      return '#coercion-' + conversions;
    },
  });
  const result = { conversions, fragment: location.hash, pathname: location.pathname };
  history.replaceState(null, '', original);
  return result;
}

function attributeCoercion() {
  const node = document.createElement('p');
  let conversions = 0;
  node.setAttribute(
    {
      toString() {
        conversions++;
        return 'title';
      },
    } as unknown as string,
    'conversion control',
  );
  return { conversions, value: node.getAttribute('title') };
}

const server = await servers();
const evidence = { date: new Date().toISOString(), browsers: [] };
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    try {
      const context = await browser.newContext();
      const manager = await context.newPage();
      await manager.goto('http://127.0.0.1:4210/privacy-frames/');
      await manager.getByText('Ready to install.', { exact: true }).waitFor();
      await manager.locator('#app-url').fill('http://127.0.0.1:4218/review/');
      await manager.locator('#install button').click();
      const link = manager.locator('[data-app="review"]');
      await link.waitFor();
      const opened = context.waitForEvent('page');
      await link.click();
      const app = await opened;
      await app.waitForFunction(() => window.privacyHost?.mode === 'network-isolated');
      await app.locator('#data').waitFor({ state: 'attached' });
      const confined = await app.evaluate(historyCoercion);
      const attribute = await app.evaluate(attributeCoercion);
      assert.deepEqual(attribute, { conversions: 1, value: 'conversion control' });
      assert.equal(confined.conversions, 1);
      assert(['', '#coercion-1'].includes(confined.fragment));
      const data = await app.evaluate(() => {
        const node = document.querySelector<HTMLScriptElement>('#data')!;
        const value = JSON.parse(node.textContent!);
        let typeBlocked = false;
        let cloneBlocked = false;
        try {
          node.type = 'speculationrules';
        } catch {
          typeBlocked = true;
        }
        try {
          document.body.append(node.cloneNode(true));
        } catch {
          cloneBlocked = true;
        }
        return { value, typeBlocked, cloneBlocked, executed: '__dataExecuted' in window };
      });
      // Restricted installation ran this script, but the page never registered
      // a foreground worker. A precache receipt must not invent registration.
      const pendingRegistration = await app.evaluate(registrationStatus);
      assert.deepEqual(pendingRegistration, {
        registrations: 0,
        registered: false,
        readyWithin250ms: false,
      });
      const bridge = manager
        .frames()
        .find((frame) => frame.url().endsWith('/connect.html'));
      assert(bridge);
      const prepared = await bridge.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('privacy-frames-installations');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          const records = await new Promise<Installation[]>((resolve, reject) => {
            const request = database
              .transaction('installations')
              .objectStore('installations')
              .getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const installation = records.find(
            (record) => record.source === 'http://127.0.0.1:4218/review/',
          );
          if (!installation) throw new Error('Review installation metadata missing');
          return installation.preparation;
        } finally {
          database.close();
        }
      });
      assert.equal(prepared.outcome.status, 'completed');
      assert.equal(
        prepared.serviceWorker?.scriptURL,
        'http://127.0.0.1:4218/review/sw.js',
      );
      assert.deepEqual(prepared.serviceWorker?.completed, ['install', 'activate']);
      assert.equal(prepared.ended, true);
      assert.deepEqual(data, {
        value: { value: 42 },
        typeBlocked: true,
        cloneBlocked: false,
        executed: false,
      });
      const control = await context.newPage();
      await control.goto('http://127.0.0.1:4218/review/');
      const nativeRegistration = await control.evaluate(registrationStatus);
      assert.deepEqual(nativeRegistration, pendingRegistration);
      const unrestricted = await control.evaluate(historyCoercion);
      const nativeAttribute = await control.evaluate(attributeCoercion);
      assert.deepEqual(nativeAttribute, attribute);
      assert.equal(unrestricted.conversions, 1);
      const controlMutation = await control.evaluate(() => {
        const node = document.querySelector<HTMLScriptElement>('#data')!;
        node.type = 'speculationrules';
        const type = node.type;
        node.type = 'application/json';
        const clone = node.cloneNode(true) as HTMLScriptElement;
        document.body.append(clone);
        return {
          type,
          cloneAttached: clone.isConnected,
          value: JSON.parse(clone.textContent!),
        };
      });
      assert.deepEqual(controlMutation, {
        type: 'speculationrules',
        cloneAttached: true,
        value: { value: 42 },
      });
      evidence.browsers.push({
        name,
        version: browser.version(),
        confined,
        attribute,
        nativeAttribute,
        unrestricted,
        data,
        prepared,
        pendingRegistration,
        nativeRegistration,
        controlMutation,
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
    new URL('../results/evaluation/review-regressions.json', import.meta.url),
    JSON.stringify(evidence, null, 2) + '\n',
  );
}
console.log(
  'History normalization and inert data blocks passed with native controls in both browsers.',
);
