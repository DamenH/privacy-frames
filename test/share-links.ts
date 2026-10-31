import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { chromium, firefox, type Page } from 'playwright';
import { launch } from './browser-profile.ts';
import { servers } from './server.ts';
import { testProvenance } from './provenance.ts';
import { createShareURL, readShareHash } from '../src/manager/share-link.ts';

const managerURL = 'http://127.0.0.1:4210/privacy-frames/';
const source = 'http://127.0.0.1:4218/review/?language=no&mode=edit';
const extra = 'http://127.0.0.1:4218/review/sw.js';
const recipe = { url: source, resourceList: { kind: 'text', text: extra } } as const;
const server = await servers();
const receipt = {
  provenance: await testProvenance(import.meta.url),
  scope:
    'Local built manager, installer and runtime on separate origins; no public deployment, PWA installation or real-device testing',
  browsers: [] as object[],
};

async function library(page: Page) {
  await page.goto(managerURL);
  await page.getByText('Ready to install.', { exact: true }).waitFor();
}

async function fallbackClipboard(page: Page) {
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('Clipboard unavailable');
        },
      },
    }),
  );
}

try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    if (process.env.SHARE_BROWSER && process.env.SHARE_BROWSER !== name) continue;
    const browser = await launch(engine);
    const context = await browser.newContext();
    const checks: string[] = [];
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const start = server.traffic.length;
      const badHashes = [
        '#v=1&url=javascript%3Aalert(1)',
        '#v=1&url=' + encodeURIComponent(source) + '&role=manager',
        '#v=1&url=' + encodeURIComponent(source) + '&url=' + encodeURIComponent(source),
        '#v=1&url=' + encodeURIComponent(source) + '&list=javascript%3Aalert(1)',
        '#v=1&url=' +
          encodeURIComponent(source) +
          '&list-gzip=' +
          gzipSync('x'.repeat(256 * 1024 + 1)).toString('base64url'),
      ];
      for (const hash of badHashes) {
        await page.goto(managerURL + hash);
        await page
          .getByRole('alert')
          .filter({ hasText: 'Could not read this share link.' })
          .waitFor();
        assert.equal(await page.getByRole('button').count(), 0);
        await page.getByRole('link', { name: 'Back to library', exact: true }).waitFor();
      }
      assert.deepEqual(
        server.traffic
          .slice(start)
          .filter((request) => ![4210, 4211, 4219].includes(request.port)),
        [],
      );
      checks.push(
        'Malformed, authority-spoofing and decompression-bomb links reject before publisher or receiver requests',
      );

      let release = () => {};
      const downloading = new Promise<void>((resolve) => {
        release = resolve;
      });
      const holdDownload = async (route: import('playwright').Route) => {
        await downloading;
        await route.continue();
      };
      await page.route('http://127.0.0.1:4218/**', holdDownload);
      const shareURL = await createShareURL(recipe, managerURL);
      await page.goto(shareURL);
      const status = page.getByRole('status');
      await status.filter({ hasText: 'Installing ' + source }).waitFor();
      assert.equal(await page.getByRole('button').count(), 0);
      assert.equal(await page.getByRole('link').count(), 1);
      assert.equal(await page.locator('nav a').textContent(), 'GitHub');
      assert.equal(await page.locator('details, .app-card, #install').count(), 0);
      assert.equal(
        await page.locator('[aria-label="Opening shared app"] .animate-spin').count(),
        1,
      );
      assert(
        !/Ready to install|Includes a resource list|Install & open/.test(
          await page.locator('body').innerText(),
        ),
      );
      await mkdir('results/screenshots/share-links', { recursive: true });
      await page.screenshot({
        path: `results/screenshots/share-links/${name}-automatic.png`,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      );
      await page.screenshot({
        path: `results/screenshots/share-links/${name}-automatic-narrow.png`,
      });
      await page.setViewportSize({ width: 1280, height: 720 });
      release();
      await page.getByText('Data document', { exact: true }).waitFor();
      await page.unroute('http://127.0.0.1:4218/**', holdDownload);
      assert.equal(context.pages().length, 1);
      assert.equal(new URL(page.url()).search, '?language=no&mode=edit');
      assert.equal(
        await page.evaluate(() => Reflect.get(window, '__dataExecuted')),
        undefined,
      );
      assert.match(
        await page.evaluate(async () => (await fetch('sw.js')).text()),
        /Unreferenced publisher code must not execute/,
      );
      assert.equal(
        server.traffic
          .slice(start)
          .filter(
            (request) =>
              request.port === 4218 && request.path === '/review/?language=no&mode=edit',
          ).length,
        1,
      );
      checks.push(
        'A minimal spinner and progress text automatically install once and open in the same tab, preserving launch queries',
      );

      const blockedStart = server.traffic.length;
      const blocked = await page.evaluate(async () => {
        try {
          await fetch('http://127.0.0.1:4366/share-link-probe');
          return false;
        } catch {
          return true;
        }
      });
      assert(blocked);
      assert.deepEqual(
        server.traffic
          .slice(blockedStart)
          .filter((request) => request.port === 4366 || request.port === 4218),
        [],
      );
      const control = await context.newPage();
      await control.goto('http://127.0.0.1:4218/review/');
      assert.equal(
        await control.evaluate(async () =>
          (await fetch('http://127.0.0.1:4366/share-link-probe')).text(),
        ),
        'diagnostic receiver',
      );
      assert(
        server.traffic
          .slice(blockedStart)
          .some(
            (request) => request.port === 4366 && request.path === '/share-link-probe',
          ),
      );
      await control.close();
      checks.push(
        'Server traffic and a working unrestricted control confirm that the automatically opened application remains confined',
      );

      await page.evaluate(() =>
        localStorage.setItem('share-private-marker', 'kept locally'),
      );
      for (const input of [
        recipe,
        {
          url: source,
          resourceList: {
            kind: 'url',
            url: 'http://127.0.0.1:4218/unavailable-list.uris',
          },
        } as const,
        {
          url: source,
          resourceList: {
            kind: 'text',
            text: 'http://127.0.0.1:4218/other-list-resource.js',
          },
        } as const,
        { url: source },
      ]) {
        const beforeOpen = server.traffic.length;
        await page.goto(await createShareURL(input, managerURL));
        await page.getByText('Data document', { exact: true }).waitFor();
        assert.deepEqual(
          server.traffic.slice(beforeOpen).filter((request) => request.port === 4218),
          [],
        );
        assert.equal(
          await page.evaluate(() => localStorage.getItem('share-private-marker')),
          'kept locally',
        );
      }
      checks.push(
        'An existing source opens immediately without fetching even a missing remote list or a changed embedded list, preserving private storage',
      );

      await library(page);
      await fallbackClipboard(page);
      const card = page.locator('.app-card');
      await card.getByRole('button', { name: 'Copy link', exact: true }).click();
      const copied = await card
        .getByRole('textbox', { name: 'Share link', exact: true })
        .inputValue();
      assert.deepEqual(await readShareHash(new URL(copied).hash), recipe);
      await page.evaluate(() =>
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: async (text: string) => {
              Reflect.set(window, 'copiedLink', text);
            },
          },
        }),
      );
      await card.getByRole('button', { name: 'Copy link', exact: true }).click();
      await card.getByRole('status').filter({ hasText: 'Link copied.' }).waitFor();
      assert.equal(await page.evaluate(() => Reflect.get(window, 'copiedLink')), copied);
      checks.push(
        'Library sharing preserves resolved resource lists with clipboard feedback and a selectable fallback',
      );

      const recipient = await browser.newContext();
      try {
        const fresh = await recipient.newPage();
        await fresh.goto(copied);
        await fresh.getByText('Data document', { exact: true }).waitFor();
        assert.equal(
          await fresh.evaluate(() => localStorage.getItem('share-private-marker')),
          null,
        );
        assert.match(
          await fresh.evaluate(async () => (await fetch('sw.js')).text()),
          /Unreferenced publisher code/,
        );
      } finally {
        await recipient.close();
      }
      checks.push(
        'A library link automatically installs and opens in fresh browser storage without transferring private data',
      );

      await page.evaluate((hash) => {
        location.hash = hash;
      }, new URL(copied).hash);
      await page.getByText('Data document', { exact: true }).waitFor();
      await page.goBack({ waitUntil: 'commit' });
      await page.locator('#app-url').waitFor();
      assert.equal(new URL(page.url()).hash, '');
      checks.push(
        'Hash navigation opens automatically and Back returns to the library without a redirect loop',
      );

      await page.locator('#app-url').fill(source);
      await page.locator('#resource-list-options summary').click();
      await page.getByLabel('Resource list', { exact: true }).selectOption('text');
      await page.locator('#resource-list-file').setInputFiles({
        name: 'resources.uris',
        mimeType: 'text/uri-list',
        buffer: Buffer.from(extra + '\n'),
      });
      await page.waitForFunction(
        (text) =>
          document.querySelector<HTMLTextAreaElement>('#resource-list-text')?.value ===
          text,
        extra + '\n',
      );
      await fallbackClipboard(page);
      await page.getByRole('button', { name: 'Copy link', exact: true }).first().click();
      assert.deepEqual(
        await readShareHash(
          new URL(
            await page
              .getByRole('textbox', { name: 'Share link', exact: true })
              .inputValue(),
          ).hash,
        ),
        recipe,
      );
      const longList = Array.from(
        { length: 300 },
        (_, index) => `https://assets.test/application/resources/module-${index}.js`,
      ).join('\n');
      await page.locator('#resource-list-text').fill(longList);
      await page.getByRole('button', { name: 'Copy link', exact: true }).first().click();
      const compressedLink = await page
        .getByRole('textbox', { name: 'Share link', exact: true })
        .inputValue();
      assert(compressedLink.includes('list-gzip='));
      assert.deepEqual(await readShareHash(new URL(compressedLink).hash), {
        url: source,
        resourceList: { kind: 'text', text: longList },
      });
      const beforeCompressed = server.traffic.length;
      await page.goto(compressedLink);
      await page.getByText('Data document', { exact: true }).waitFor();
      assert.deepEqual(
        server.traffic.slice(beforeCompressed).filter((request) => request.port === 4218),
        [],
      );
      checks.push(
        'Form sharing embeds uploaded lists; compressed browser-generated links decode and automatically open the installed copy',
      );

      await page.goto(await createShareURL({ url: source + '&list=none' }, managerURL));
      await page.getByText('Data document', { exact: true }).waitFor();
      checks.push(
        'A new application URL without a resource list automatically installs and opens',
      );

      const urlListLink = await createShareURL(
        {
          url: 'http://127.0.0.1:4212/',
          resourceList: { kind: 'url', url: 'http://127.0.0.1:4212/resource-list.uris' },
        },
        managerURL,
      );
      const listStart = server.traffic.length;
      await page.goto(urlListLink);
      await page.locator('#note').waitFor();
      assert(
        server.traffic
          .slice(listStart)
          .some(
            (request) => request.port === 4212 && request.path === '/resource-list.uris',
          ),
      );
      checks.push(
        'A remote resource list is automatically installed and the Notes application opens',
      );

      const missingLink = await createShareURL(
        {
          url: source + '&missing=1',
          resourceList: {
            kind: 'text',
            text: 'http://127.0.0.1:4218/missing-share-resource.js',
          },
        },
        managerURL,
      );
      const failureStart = server.traffic.length;
      await page.goto(missingLink);
      await page
        .getByRole('alert')
        .filter({ hasText: 'Installation refused:' })
        .waitFor();
      assert.equal(page.url(), missingLink);
      assert.equal(await page.getByRole('button').count(), 0);
      assert.equal(await page.locator('.animate-spin').count(), 0);
      await page.evaluate(() => new Promise(requestAnimationFrame));
      assert.equal(
        server.traffic
          .slice(failureStart)
          .filter((request) => request.path === '/missing-share-resource.js').length,
        1,
      );
      await page.getByRole('link', { name: 'Back to library', exact: true }).click();
      await page.locator('#app-url').waitFor();
      assert.equal(new URL(page.url()).hash, '');
      checks.push(
        'An unavailable required resource stops automatic installation once and shows an error with only a library link',
      );
      let resume = () => {};
      const pending = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const holdChangedLink = async (route: import('playwright').Route) => {
        await pending;
        await route.continue();
      };
      await page.route('http://127.0.0.1:4218/**', holdChangedLink);
      await page.evaluate(
        (hash) => {
          location.hash = hash;
        },
        new URL(await createShareURL({ url: source + '&changed=1' }, managerURL)).hash,
      );
      await page.getByRole('status').filter({ hasText: 'Installing ' }).waitFor();
      await page.evaluate((hash) => {
        location.hash = hash;
      }, new URL(shareURL).hash);
      resume();
      await page.getByText('Data document', { exact: true }).waitFor();
      assert.equal(new URL(page.url()).search, '?language=no&mode=edit');
      await page.unroute('http://127.0.0.1:4218/**', holdChangedLink);
      checks.push(
        'Changing links during installation cannot redirect to the previous link’s app',
      );
      assert.deepEqual(errors, []);
      receipt.browsers.push({ name, version: browser.version(), checks });
      console.log(name, browser.version(), checks);
    } finally {
      await context.close();
      await browser.close();
    }
  }
} finally {
  await server.close();
  await mkdir('results', { recursive: true });
  await writeFile('results/share-links.json', JSON.stringify(receipt, null, 2) + '\n');
}
