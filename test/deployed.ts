import { launch } from './browser-profile.ts';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
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
    const row = { name, version: browser.version(), checks: [], errors: [] };
    report.browsers.push(row);
    page.on('pageerror', (e) => row.errors.push(e.message));
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
        await page.locator('#app-url').fill(example.url);
        await page.locator('#install button').click();
        await page.waitForFunction(
          () =>
            /^(Installed |Installation refused:)/.test(
              document.querySelector('#status').textContent,
            ),
          {},
          { timeout: 300000 },
        );
        assert.match(
          await page.locator('#status').textContent(),
          /^Installed /,
          example.url,
        );
      }
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
        app.on('pageerror', (e) => row.errors.push(id + ': ' + e.message));
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
      await app.reload({ waitUntil: 'commit' });
      await app.waitForFunction(() =>
        document.querySelector('#mode')?.textContent.includes('network isolated'),
      );
      assert.equal(
        await app.locator('#note').inputValue(),
        'Synthetic deployed private note',
      );
      await app.close();
      row.checks.push(
        'Readable app URL, native notes, persistent scoped storage and no opener',
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
