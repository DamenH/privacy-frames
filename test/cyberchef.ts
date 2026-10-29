import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';
import { testProvenance } from './provenance.ts';
import {
  cyberChefCancelRestart,
  cyberChefTextAndFile,
  observeCyberChefWorkers,
} from './helpers/cyberchef.ts';

const source = 'https://gchq.github.io/CyberChef/';
const host = process.env.HOST_URL;
const resultsPath =
  process.env.CYBERCHEF_RESULTS || 'results/evaluation/cyberchef-tasks.json';
const receipt = {
  provenance: await testProvenance(import.meta.url),
  source,
  results: [] as unknown[],
};
let failures = 0;
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    if (process.env.CYBERCHEF_BROWSER && process.env.CYBERCHEF_BROWSER !== name) continue;
    const browser = await launch(engine);
    try {
      for (const mode of host ? ['standalone', 'confined'] : ['standalone']) {
        const context = await browser.newContext({
          viewport: { width: 1280, height: 800 },
        });
        context.setDefaultTimeout(30000);
        const manager = await context.newPage();
        const errors: string[] = [];
        context.on('page', (page) => {
          page.on('pageerror', (error) => errors.push(error.message));
          page.on('crash', () => errors.push('Browser page crashed'));
        });
        manager.on('pageerror', (error) => errors.push(error.message));
        manager.on('crash', () => errors.push('Browser page crashed'));
        const row: Record<string, unknown> = {
          browser: name,
          version: browser.version(),
          mode,
          errors,
        };
        let finalWorkers: ReturnType<typeof observeCyberChefWorkers> | undefined;
        const failedTasks: string[] = [];
        const progress: unknown[] = [];
        row.progress = progress;
        row.failedTasks = failedTasks;
        receipt.results.push(row);
        try {
          let app = manager;
          let workers = observeCyberChefWorkers(app);
          if (mode === 'standalone') {
            const response = await app.goto(source, {
              waitUntil: 'domcontentloaded',
              timeout: 120000,
            });
            if (response) {
              row.entryStatus = response.status();
              row.entrySHA256 = createHash('sha256')
                .update(await response.body())
                .digest('hex');
            }
          } else {
            assert(host);
            await manager.goto(host);
            await manager.getByText('Ready to install.', { exact: true }).waitFor();
            await manager.locator('#app-url').fill(source);
            row.resourceListUsed = (await manager.locator('#resource-list-url').count())
              ? await manager.locator('#resource-list-url').inputValue()
              : null;
            const installationStarted = performance.now();
            try {
              await manager.locator('#install button').click();
              await manager.waitForFunction(
                () =>
                  /^(Installed |Installation refused:)/.test(
                    document.querySelector('#status')?.textContent || '',
                  ),
                undefined,
                { timeout: 330000 },
              );
            } finally {
              row.installationElapsedMs = performance.now() - installationStarted;
            }
            const status = await manager.locator('#status').innerText();
            row.installation = status;
            assert(status.startsWith('Installed '), status);
            const opened = context.waitForEvent('page');
            await manager
              .locator('.app-card')
              .getByRole('link', { name: 'Open', exact: true })
              .click();
            app = await opened;
            workers = observeCyberChefWorkers(app);
            await app.waitForFunction(
              () => window.privacyHost?.mode === 'network-isolated',
            );
          }
          row.url = app.url();
          row.workers = workers;
          finalWorkers = workers;
          await app.locator('[contenteditable=true]').first().waitFor();
          if (process.env.CYBERCHEF_TASK !== 'cancel')
            row.textAndFile = await cyberChefTextAndFile(app);
          if (process.env.CYBERCHEF_TASK !== 'text') {
            if (process.env.CYBERCHEF_TASK !== 'cancel')
              await app.goto(app.url().split('#')[0], { waitUntil: 'commit' });
            if (mode === 'confined')
              await app.waitForFunction(
                () => window.privacyHost?.mode === 'network-isolated',
              );
            await app.locator('[contenteditable=true]').first().waitFor();
            const cancellation = await cyberChefCancelRestart(
              app,
              workers,
              (stage, details) => {
                progress.push({ mode: 'online', stage, details });
                if (process.env.CYBERCHEF_TRACE) console.log(stage, details);
              },
            );
            row.cancelRestartSVG = cancellation;
            if (!cancellation.animated) failedTasks.push('SVG animation');
          }
          if (mode === 'confined') {
            await context.setOffline(true);
            await app.reload({ waitUntil: 'commit' });
            await app.waitForFunction(
              () => window.privacyHost?.mode === 'network-isolated',
            );
            row.offlineTextAndFile = await cyberChefTextAndFile(app);
            if (process.env.CYBERCHEF_TASK !== 'text') {
              await app.goto(app.url().split('#')[0], { waitUntil: 'commit' });
              await app.waitForFunction(
                () => window.privacyHost?.mode === 'network-isolated',
              );
              await app.locator('[contenteditable=true]').first().waitFor();
              const offlineCancellation = await cyberChefCancelRestart(
                app,
                workers,
                (stage, details) => progress.push({ mode: 'offline', stage, details }),
              );
              row.offlineCancelRestartSVG = offlineCancellation;
              if (!offlineCancellation.animated)
                failedTasks.push('offline SVG animation');
            }
          }
          row.workers = workers;
          assert(workers.started.length > 0, 'No actual browser Worker observed');
          row.passed = failedTasks.length === 0;
          failures += failedTasks.length;
        } catch (error) {
          failures++;
          row.failure = error instanceof Error ? error.stack : String(error);
        } finally {
          if (finalWorkers)
            row.workers = {
              started: [...finalWorkers.started],
              closed: [...finalWorkers.closed],
            };
          console.log(name, mode, JSON.stringify(row));
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await mkdir(dirname(resultsPath), { recursive: true });
  await writeFile(resultsPath, JSON.stringify(receipt, null, 2) + '\n');
}
if (failures) process.exitCode = 1;
