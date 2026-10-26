import { launchPersistent } from './browser-profile.ts';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, firefox } from 'playwright';
import { servers } from './server.ts';
const deployed = !!process.env.HOST_URL,
  hostURL = process.env.HOST_URL || 'http://127.0.0.1:4210/privacy-frames/';
const server = deployed ? { close: async () => {} } : await servers(),
  results = [];
const documentURL =
  process.env.DOCUMENT_URL || 'http://127.0.0.1:4218/document/index.html';
const articleURL = 'https://en.wikipedia.org/w/rest.php/v1/page/Albert_Einstein/html';
const includeArticle = process.env.LIVE_ARTICLE === '1';
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const directory = await mkdtemp(join(tmpdir(), 'pf-compatibility-'));
    let context = await launchPersistent(
      engine,
      directory,
      name === 'chromium' ? { executablePath: chromium.executablePath() } : {},
    );
    context.setDefaultTimeout(30000);
    const row = { name, checks: [], pwas: [] };
    results.push(row);
    const installed = [];
    try {
      const page = context.pages()[0],
        initialPages = context.pages().length;
      await page.goto(hostURL);
      await page.getByText('Ready to install.', { exact: true }).waitFor();
      assert.equal(context.pages().length, initialPages);
      assert.equal(page.frames().length, 2);
      const bridge = page.frames().find((frame) => frame.url().endsWith('/connect.html'));
      assert(bridge);
      console.log(name, 'compatibility checkpoint');
      row.checks.push('Automatic iframe connection creates no installation tab');
      async function install(url) {
        await page.locator('#app-url').fill(url);
        await page.locator('#install button').click();
        await page.waitForFunction(
          () =>
            /^(Installed |Installation refused:)/.test(
              document.querySelector('#status').textContent,
            ),
          {},
          { timeout: 120000 },
        );
        assert.match(await page.locator('#status').textContent(), /^Installed /);
      }
      async function open(id) {
        const opened = context.waitForEvent('page');
        await page.locator(`[data-app="${id}"]`).click();
        const app = await opened;
        await app.waitForFunction(() => window.privacyHost?.mode === 'network-isolated');
        return app;
      }
      await install(documentURL);
      const doc = await open('document');
      await doc.locator('h1').getByText('Ordinary document', { exact: true }).waitFor();
      assert.equal(await doc.locator('base').count(), 0);
      assert.equal(await doc.locator('html').getAttribute('lang'), 'en');
      assert.equal(await doc.locator('body').getAttribute('class'), 'imported-document');
      await doc.waitForFunction(
        () => document.querySelector('#illustration')?.naturalWidth > 0,
      );
      await doc.waitForFunction(
        () =>
          getComputedStyle(document.querySelector('h1')).color === 'rgb(169, 199, 255)',
      );
      await doc.locator('#section-link').click();
      await doc.waitForURL('**#section');
      assert.equal(new URL(doc.url()).hash, '#section');
      const manifest = await doc.evaluate(
        async () =>
          await (await fetch(document.querySelector('link[rel="manifest"]').href)).json(),
      );
      assert.equal(manifest.name, 'Generic imported document');
      assert.equal(manifest.shortcuts.length, 1);
      assert(manifest.start_url.endsWith('/document/#section'));
      assert.equal(manifest.icons.length, 2);
      const runtimeRoot = new URL(bridge.url());
      runtimeRoot.pathname = runtimeRoot.pathname.replace(/connect.html$/, '');
      const manifestId = new URL(manifest.id, runtimeRoot).href;
      if (name === 'chromium') {
        const session = await context.newCDPSession(doc),
          report = await session.send('Page.getAppManifest');
        assert.equal(report.errors.length, 0);
        assert.deepEqual(
          (await session.send('Page.getInstallabilityErrors')).installabilityErrors,
          [],
        );
        await session.send('PWA.install', {
          manifestId,
          installUrlOrBundleUrl: doc.url(),
        });
        installed.push(manifestId);
        await session.send('PWA.changeAppUserSettings', {
          manifestId,
          displayMode: 'standalone',
        });
        row.pwas.push({
          manifestId,
          state: await session.send('PWA.getOsAppState', { manifestId }),
        });
      }
      await context.setOffline(true);
      await doc.reload();
      await doc.waitForFunction(
        () => document.querySelector('#illustration')?.naturalWidth > 0,
      );
      await doc.waitForFunction(
        () =>
          getComputedStyle(document.querySelector('h1')).color === 'rgb(169, 199, 255)',
      );
      await context.setOffline(false);
      console.log(name, 'compatibility checkpoint');
      row.checks.push(
        'Generic base URL, nested CSS, image, fragment and inherited manifest work offline',
      );
      const config = await page.evaluate(
        async () => await (await fetch('./config.json')).json(),
      );
      const notes = config.examples.find((example) => example.name === 'Notebook');
      await install(notes.url);
      const note = await open('notes');
      await note.waitForFunction(() =>
        document.querySelector('#mode')?.textContent.includes('network isolated'),
      );
      await note.locator('#note').fill('private compatibility state');
      await note.locator('#save').click();
      const noteManifest = await note.evaluate(
        async () =>
          await (await fetch(document.querySelector('link[rel="manifest"]').href)).json(),
      );
      const noteId = new URL(noteManifest.id, runtimeRoot).href;
      assert.notEqual(noteId, manifestId);
      assert.equal(await doc.evaluate(() => localStorage.getItem('note')), null);
      if (name === 'chromium') {
        const session = await context.newCDPSession(note);
        await session.send('PWA.install', {
          manifestId: noteId,
          installUrlOrBundleUrl: note.url(),
        });
        installed.push(noteId);
        await session.send('PWA.changeAppUserSettings', {
          manifestId: noteId,
          displayMode: 'standalone',
        });
        row.pwas.push({
          manifestId: noteId,
          state: await session.send('PWA.getOsAppState', { manifestId: noteId }),
        });
        const launched = await session.send('PWA.launch', { manifestId });
        const window =
          context
            .pages()
            .find(
              (p) =>
                p !== doc &&
                p
                  .url()
                  .startsWith(
                    new URL(manifest.start_url, runtimeRoot).href.split('#')[0],
                  ),
            ) || (await context.waitForEvent('page'));
        await window.waitForFunction(
          () => document.querySelector('#illustration')?.naturalWidth > 0,
        );
        assert.equal(new URL(window.url()).hash, '#section');
        console.log(name, 'compatibility checkpoint');
        row.checks.push(
          'Two native PWAs install independently and launch with the saved hash route',
        );
        await window.close();
      }
      if (includeArticle) {
        await install(articleURL);
        const article = await open('albert-einstein');
        await article.getByText('Albert Einstein', { exact: true }).first().waitFor();
        await article.evaluate(() => {
          for (const image of document.images) image.loading = 'eager';
        });
        await article.waitForFunction(
          () =>
            Array.from(document.images).every(
              (image) => image.complete && image.naturalWidth > 0,
            ),
          {},
          { timeout: 60000 },
        );
        const images = await article.locator('img').count();
        await context.setOffline(true);
        await article.reload();
        await article.waitForFunction(
          () => window.privacyHost?.mode === 'network-isolated',
        );
        await article.evaluate(() => {
          for (const image of document.images) image.loading = 'eager';
        });
        await article.waitForFunction(
          () =>
            Array.from(document.images).length > 0 &&
            Array.from(document.images).every(
              (image) => image.complete && image.naturalWidth > 0,
            ),
        );
        await context.setOffline(false);
        row.article = { url: articleURL, images, offline: true };
        console.log(name, 'compatibility checkpoint');
        row.checks.push(
          'Unmodified live Wikipedia HTML and every captured image render offline',
        );
        await article.close();
      }
      if (name === 'chromium' && process.env.LIVE_PITCH_NATIVE === '1') {
        await install('https://damenh.github.io/pitch-training/');
        const pitch = await open('pitch-training');
        await pitch.getByRole('navigation', { name: 'Main', exact: true }).waitFor();
        const session = await context.newCDPSession(pitch),
          report = await session.send('Page.getAppManifest');
        assert.deepEqual(report.errors, []);
        assert.deepEqual(
          (await session.send('Page.getInstallabilityErrors')).installabilityErrors,
          [],
        );
        const identity = report.manifest.id;
        await session.send('PWA.install', {
          manifestId: identity,
          installUrlOrBundleUrl: pitch.url(),
        });
        installed.push(identity);
        row.pwas.push({
          manifestId: identity,
          state: await session.send('PWA.getOsAppState', { manifestId: identity }),
          application: 'unchanged Pitch Training',
        });
        row.checks.push(
          'Unchanged Pitch Training also installs as an individual native PWA',
        );
        await pitch.close();
      }
      const noteURL = note.url();
      await doc.close();
      await note.close();
      await context.close();
      context = await launchPersistent(
        engine,
        directory,
        name === 'chromium' ? { executablePath: chromium.executablePath() } : {},
      );
      context.setDefaultTimeout(30000);
      const restored = context.pages()[0];
      await restored.goto(noteURL);
      await restored.waitForFunction(() =>
        document.querySelector('#mode')?.textContent.includes('network isolated'),
      );
      assert.equal(
        await restored.locator('#note').inputValue(),
        'private compatibility state',
      );
      console.log(name, 'compatibility checkpoint');
      row.checks.push(
        'Iframe installation and private storage survive full browser restart',
      );
      if (name === 'chromium') {
        const session = await context.newCDPSession(restored);
        await context.setOffline(true);
        const launched = await session.send('PWA.launch', { manifestId: noteId });
        let nativeWindow;
        for (let attempt = 0; attempt < 50 && !nativeWindow; attempt++) {
          for (const candidate of context.pages()) {
            const probe = await context.newCDPSession(candidate);
            const { targetInfo } = await probe.send('Target.getTargetInfo');
            await probe.detach();
            if (
              candidate !== restored &&
              candidate.url().startsWith(noteURL.split('#')[0]) &&
              (await candidate.evaluate(
                () => matchMedia('(display-mode: standalone)').matches,
              ))
            ) {
              nativeWindow = candidate;
              break;
            }
          }
          if (!nativeWindow) await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert(nativeWindow, 'Native PWA launch target must be observable');
        await nativeWindow.waitForFunction(() =>
          document.querySelector('#mode')?.textContent.includes('network isolated'),
        );
        assert.equal(
          await nativeWindow.locator('#note').inputValue(),
          'private compatibility state',
        );
        await context.setOffline(false);
        row.checks.push(
          'Native PWA cold-launches offline with private state after browser restart',
        );
        for (const id of installed)
          await session.send('PWA.uninstall', { manifestId: id });
        installed.length = 0;
      }
      await restored.close();
    } catch (error) {
      row.failure = error.stack;
      throw error;
    } finally {
      if (name === 'chromium' && installed.length)
        try {
          const cleanupPage = context.pages()[0] || (await context.newPage());
          const session = await context.newCDPSession(cleanupPage);
          for (const id of installed)
            try {
              await session.send('PWA.uninstall', { manifestId: id });
            } catch {}
        } catch {}
      await context.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
} finally {
  await server.close();
  await writeFile(
    new URL(
      `../results/compatibility${deployed ? '-deployed' : ''}.json`,
      import.meta.url,
    ),
    JSON.stringify(results, null, 2) + '\n',
  );
}
console.log(
  results
    .map(
      (r) =>
        `${r.name}: ${r.checks.length} compatibility groups passed; ${r.pwas.length} native PWA installations`,
    )
    .join('\n'),
);
