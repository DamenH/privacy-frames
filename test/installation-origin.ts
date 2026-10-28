import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';
import { servers } from './server.ts';
import { testProvenance } from './provenance.ts';

const server = await servers({ receiver: false });
const results = [];
const provenance = await testProvenance(import.meta.url);
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    const context = await browser.newContext();
    const checks: string[] = [];
    try {
      const manager = await context.newPage();
      await manager.goto('http://127.0.0.1:4210/privacy-frames/');
      await manager.getByText('Ready to install.', { exact: true }).waitFor();
      await manager.evaluate(() => localStorage.setItem('manager-secret', 'host-only'));
      const start = server.traffic.length;
      await manager.locator('#app-url').fill('http://127.0.0.1:4212/');
      await manager.locator('#install button').click();
      await manager.getByText('Installed Notes.', { exact: true }).waitFor();
      const downloads = server.traffic
        .slice(start)
        .filter((request) => request.port === 4212);
      assert(downloads.length > 0);
      assert(downloads.every((request) => request.origin === 'http://127.0.0.1:4219'));
      assert.equal(await manager.locator('#installation-bridge').count(), 0);
      checks.push(
        'Publisher downloads originate only from the installation origin; collector removed before completion',
      );

      const outsider = await context.newPage();
      await outsider.goto('http://127.0.0.1:4212/');
      const beforeForgery = server.traffic.length;
      const forged = await outsider.evaluate(async () => {
        const frame = document.createElement('iframe');
        frame.src = 'http://127.0.0.1:4219/installation/';
        const loaded = new Promise<void>((resolve) => {
          frame.onload = () => resolve();
        });
        document.body.append(frame);
        await loaded;
        const session = crypto.randomUUID();
        const channel = new MessageChannel();
        const replies: unknown[] = [];
        channel.port1.onmessage = (event) => {
          replies.push(event.data);
          channel.port1.postMessage({
            type: 'prepare',
            session,
            url: 'http://127.0.0.1:4213/',
          });
        };
        frame.contentWindow?.postMessage(
          { type: 'pf-install-connect', session },
          'http://127.0.0.1:4219',
          [channel.port2],
        );
        await new Promise((resolve) => setTimeout(resolve, 500));
        channel.port1.close();
        frame.remove();
        return replies;
      });
      assert.deepEqual(forged, []);
      assert.equal(
        server.traffic.slice(beforeForgery).filter((request) => request.port === 4213)
          .length,
        0,
      );
      await outsider.close();
      checks.push(
        'Publisher parent cannot obtain an installation channel or cause downloads',
      );

      await manager.evaluate(() => {
        void navigator.locks.request(
          'privacy-frames-installation',
          () =>
            new Promise<void>((resolve) => {
              Object.defineProperty(window, 'releaseInstallationTestLock', {
                configurable: true,
                value: resolve,
              });
            }),
        );
      });
      await manager.waitForFunction(() => 'releaseInstallationTestLock' in window);
      const second = await context.newPage();
      await second.goto('http://127.0.0.1:4210/privacy-frames/');
      await second.getByText('Ready to install.', { exact: true }).waitFor();
      await second.locator('#app-url').fill('http://127.0.0.1:4213/');
      await second.locator('#install button').click();
      await second.getByText('Waiting for installation…', { exact: true }).waitFor();
      assert.equal(await second.locator('#installation-bridge').count(), 0);
      await manager.evaluate(() => {
        const release: unknown = Reflect.get(window, 'releaseInstallationTestLock');
        if (typeof release !== 'function') throw new Error('Missing lock release');
        release();
      });
      await second.getByText('Installed Image.', { exact: true }).waitFor();
      checks.push(
        'A second manager tab waits for the shared installation lock and proceeds after release',
      );
      await second.close();

      const opened = context.waitForEvent('page');
      await manager.locator('[data-app="notes"]').click();
      const app = await opened;
      await app.waitForFunction(() => window.privacyHost?.mode === 'network-isolated');
      assert.equal(
        await app.evaluate(() => localStorage.getItem('manager-secret')),
        null,
      );
      await app.locator('#note').fill('confined after remote installation');
      await app.locator('#save').click();
      checks.push(
        'Remotely prepared installation is admitted and runs with separate manager storage',
      );
      results.push({ name, version: browser.version(), checks });
    } catch (error) {
      results.push({ name, version: browser.version(), checks, failure: String(error) });
      throw error;
    } finally {
      await context.close();
      await browser.close();
    }
  }
} finally {
  await server.close();
  await writeFile(
    'results/installation-origin.json',
    JSON.stringify({ provenance, results }, null, 2) + '\n',
  );
}
console.log(
  results
    .map((row) => `${row.name}: ${row.checks.length} installation-origin checks`)
    .join('\n'),
);
