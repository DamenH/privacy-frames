import { launch } from './browser-profile.ts';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import type { Page } from 'playwright';
import type { Installation } from '../src/shared/types.ts';
import { checkBoundaryProbes, checkBoundaryProbeUI } from './helpers/boundary-probes.ts';
const hostURL = process.env.HOST_URL || 'https://pf.damenh.com/';
const report = { date: new Date().toISOString(), entry: hostURL, browsers: [] };
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(
        engine,
        name === 'chromium' ? { executablePath: chromium.executablePath() } : {},
      ),
      context = await browser.newContext({ viewport: { width: 1100, height: 900 } }),
      page = await context.newPage();
    const row = {
      name,
      version: browser.version(),
      checks: [],
      errors: [] as string[],
      errorEvents: [] as {
        role: string;
        phase: string;
        installationURL?: string;
        message: string;
        name: string;
        stack: string;
        pageURL: string;
      }[],
      installations: [] as {
        url: string;
        status: string;
        installationElapsedMs: number;
        resourceListUsed: string | null;
        capture: Installation['capture'];
        resources: number;
        bytes: number;
      }[],
    };
    report.browsers.push(row);
    let phase = 'manager-startup';
    let installationURL: string | undefined;
    function observeErrors(target: Page, role: 'manager' | 'application', label = '') {
      target.on('pageerror', (error) => {
        row.errors.push(label + error.message);
        row.errorEvents.push({
          role,
          phase,
          installationURL,
          message: error.message,
          name: error.name,
          stack: error.stack || '',
          pageURL: target.url(),
        });
      });
    }
    observeErrors(page, 'manager');
    try {
      await page.goto(hostURL);
      await page.locator('#refresh-apps').waitFor();
      await page.getByText('Ready to install.', { exact: true }).waitFor();
      const base = new URL('./', page.url());
      report.manager = base.href;
      const config = await (
        await page.request.get(new URL('config.json', base).href)
      ).json();
      assert.equal(base.origin, new URL(config.managerURL).origin);
      assert.notEqual(base.origin, new URL(config.runtimeURL).origin);
      assert.equal(
        new Set([
          base.origin,
          new URL(config.runtimeURL).origin,
          new URL(config.installationURL).origin,
        ]).size,
        3,
      );
      assert.deepEqual(config.managerOrigins, [base.origin]);
      assert.equal(await page.locator('iframe').count(), 1);
      assert.equal(context.pages().length, 1);
      assert.equal(
        await page.evaluate(
          () => getComputedStyle(document.documentElement).backgroundColor,
        ),
        'rgb(17, 19, 22)',
      );
      row.checks.push(
        'Dedicated dark manager, separate runtime and exact production management origin',
      );
      for (const example of config.examples) {
        phase = 'installation';
        installationURL = example.url;
        await page.locator('#app-url').fill(example.url);
        const resourceListUsed = (await page.locator('#resource-list-url').count())
          ? await page.locator('#resource-list-url').inputValue()
          : null;
        if (example.resourceListURL)
          assert.equal(resourceListUsed, example.resourceListURL);
        const installationStarted = performance.now();
        await page.locator('#install button').click();
        await page.waitForFunction(
          () =>
            /^(Installed |Installation refused:)/.test(
              document.querySelector('#status').textContent,
            ),
          {},
          { timeout: 300000 },
        );
        const status = await page.locator('#status').textContent();
        assert.match(status, /^Installed /, example.url);
        const installationElapsedMs = performance.now() - installationStarted;
        const bridge = page
          .frames()
          .find((frame) => frame.url().endsWith('/connect.html'));
        assert(bridge);
        const source = new URL(example.url);
        source.hash = '';
        const capture = await bridge.evaluate(async (source) => {
          const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('privacy-frames-resources');
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
            const installation = records.find((record) => record.source === source);
            if (!installation) throw new Error('Installed metadata missing');
            if (installation.format !== 'offline-resources-v1')
              throw new Error('Unexpected installation format');
            return {
              capture: installation.capture,
              resources: installation.resources.length,
              bytes: installation.size,
            };
          } finally {
            database.close();
          }
        }, source.href);
        row.installations.push({
          url: example.url,
          status,
          installationElapsedMs,
          resourceListUsed,
          ...capture,
        });
      }
      phase = 'runtime';
      installationURL = undefined;
      assert.equal(await page.locator('.app-card').count(), config.examples.length);
      await page.reload();
      await page.locator('[data-app="pitch-training"]').waitFor();
      row.checks.push(
        'All example URLs install, including independently developed applications, and library metadata survives reload',
      );
      async function launch(id, ready = true) {
        const opened = context.waitForEvent('page');
        await page.locator(`[data-app="${id}"]`).click();
        const app = await opened;
        observeErrors(app, 'application', id + ': ');
        if (ready)
          await app.waitForFunction(() =>
            document.querySelector('#mode')?.textContent.includes('network isolated'),
          );
        assert.equal(new URL(app.url()).origin, new URL(config.runtimeURL).origin);
        assert(app.url().includes('/' + id + '/'));
        assert.equal(await app.evaluate(() => window.opener), null);
        return app;
      }
      let app = await launch('notes');
      await app.locator('#note').fill('Synthetic deployed private note');
      await app.locator('#save').click();
      const confinedResponse = await app.reload({ waitUntil: 'commit' });
      assert.equal(
        confinedResponse?.headers()['connection-allowlist'],
        '(response-origin); redirects=block; webrtc=block',
        'Installed document must carry the browser connection policy',
      );
      await app.waitForFunction(() =>
        document.querySelector('#mode')?.textContent.includes('network isolated'),
      );
      assert.equal(
        await app.locator('#note').inputValue(),
        'Synthetic deployed private note',
      );
      await app.close();
      row.checks.push(
        'Readable app URL, native notes, persistent scoped storage, connection policy and no opener',
      );
      const photoCraftLink = page
        .locator('.app-card')
        .filter({ has: page.getByRole('heading', { name: 'PhotoCraft', exact: true }) })
        .getByRole('link', { name: 'Open', exact: true });
      app = await launch(await photoCraftLink.getAttribute('data-app'), false);
      await app.waitForFunction(
        () =>
          document.querySelector('#photocraft_loading') === null &&
          document.querySelector('canvas')?.width > 0,
        {},
        { timeout: 60000 },
      );
      await context.setOffline(true);
      await app.reload({ waitUntil: 'commit' });
      await app.waitForFunction(
        () =>
          document.querySelector('#photocraft_loading') === null &&
          document.querySelector('canvas')?.width > 0,
        {},
        { timeout: 60000 },
      );
      await context.setOffline(false);
      await app.close();
      row.checks.push('PhotoCraft renders its canvas and starts offline');
      app = await launch('notes');
      await app
        .getByText('Article loaded using native fetch.', { exact: true })
        .waitFor();
      assert(
        await app
          .locator('#illustration')
          .evaluate((img) => img.complete && img.naturalWidth > 0),
      );
      await app.close();
      await page.evaluate(() =>
        localStorage.setItem('host-private-canary', 'synthetic-manager-value'),
      );
      app = await launch('adversary');
      assert.equal(
        await app.evaluate(() => localStorage.getItem('host-private-canary')),
        null,
      );
      row.boundaryCapabilities = await checkBoundaryProbes(app);
      row.probes = await checkBoundaryProbeUI(app);
      await app.close();
      row.checks.push(
        'Hostile operations remain denied while inert documents, local evaluation and prepared contexts work',
      );
      app = await launch('playground');
      await app.locator('#secret').fill('synthetic-hosted-playground-marker');
      await app.locator('#run').click();
      await app.waitForFunction(() =>
        document.querySelector('#output').textContent.includes('BLOCKED:'),
      );
      await app
        .locator('#javascript')
        .fill(
          'preview.querySelector("#result").textContent="Edited code ran"; log("EDITED");',
        );
      await app.locator('#run').click();
      await app.waitForFunction(() =>
        document.querySelector('#output').textContent.includes('EDITED'),
      );
      assert.equal(await app.evaluate(() => window.length), 0);
      await app.close();
      row.checks.push('Editable HTML/CSS/JavaScript runs inside the restricted realm');

      app = await launch('pitch-training', false);
      await app.getByRole('navigation', { name: 'Main', exact: true }).waitFor();
      await app
        .getByRole('navigation', { name: 'Main', exact: true })
        .getByRole('link', { name: 'Reference', exact: true })
        .click();
      await app.getByRole('button', { name: 'Load C major scale', exact: true }).click();
      await app
        .getByRole('textbox', { name: 'Piece title', exact: true })
        .fill('Synthetic deployed score');
      await app.getByRole('button', { name: 'Save to library', exact: true }).click();
      await app
        .getByRole('button', { name: 'Synthetic deployed score', exact: true })
        .waitFor();
      await context.setOffline(true);
      await app.reload({ waitUntil: 'commit' });
      await app
        .getByRole('button', { name: 'Synthetic deployed score', exact: true })
        .waitFor();
      await context.setOffline(false);
      await app.close();
      row.checks.push(
        'Published Pitch Training renders, saves a score and reopens its hash route offline',
      );
      await context.setOffline(true);
      await page.reload();
      await page.locator('[data-app="notes"]').waitFor();
      app = await launch('notes');
      await app
        .getByText('Article loaded using native fetch.', { exact: true })
        .waitFor();
      await app.close();
      await context.setOffline(false);
      row.checks.push('Static manager and installed reader launch offline');
      await page.locator('#refresh-apps').click();
      await page.getByText('Ready to install.', { exact: true }).waitFor();
      app = await launch('notes');
      assert(
        await app.evaluate(async () => {
          try {
            await fetch(new URL('/uninstalled-diagnostic-marker', location.origin));
            return false;
          } catch {
            return true;
          }
        }),
      );
      await page.locator('.observations summary').click();
      await page.locator('#refresh-events').click();
      await page.waitForFunction(() =>
        document
          .querySelector('#events')
          .textContent.includes('uninstalled-diagnostic-marker'),
      );
      await app.close();
      row.checks.push(
        'Reconnected manager obtains a specific worker-denial diagnostic after reload',
      );
      const response = await page.request.get(new URL('report.html', base).href);
      assert.equal(response.status(), 200);
      assert((await response.text()).includes('Threat model'));
      row.checks.push('Current standalone report delivered');
      assert.deepEqual(row.errors, []);
      if (name === 'chromium') {
        await page.screenshot({
          path: new URL('../results/desktop.png', import.meta.url).pathname,
          fullPage: true,
        });
        await page.setViewportSize({ width: 390, height: 844 });
        assert(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        );
        await page.screenshot({
          path: new URL('../results/mobile.png', import.meta.url).pathname,
          fullPage: true,
        });
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
  await writeFile(
    new URL(
      '../results/' + (process.env.EVIDENCE_FILE || 'deployed.json'),
      import.meta.url,
    ),
    JSON.stringify(report, null, 2) + '\n',
  );
}
console.log(
  report.browsers
    .map((row) => `${row.name}: ${row.checks.length} deployed groups passed`)
    .join('\n'),
);
