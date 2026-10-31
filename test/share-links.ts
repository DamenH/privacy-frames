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

async function ready(page: Page) {
  try {
    await page.getByRole('status').filter({ hasText: 'Ready to install.' }).waitFor();
  } catch (error) {
    console.error(
      'Manager not ready',
      page.url(),
      await page.locator('body').innerText(),
    );
    console.error(
      'Worker state',
      await page.evaluate(async () => ({
        controller: navigator.serviceWorker.controller?.state,
        registrations: (await navigator.serviceWorker.getRegistrations()).map((r) => ({
          scope: r.scope,
          active: r.active?.state,
          waiting: r.waiting?.state,
          installing: r.installing?.state,
        })),
        caches: await caches.keys(),
      })),
    );
    throw error;
  }
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
        assert.equal(
          await page.getByRole('button', { name: 'Install & open', exact: true }).count(),
          0,
        );
      }
      assert.deepEqual(
        server.traffic
          .slice(start)
          .filter((request) => ![4210, 4211, 4219].includes(request.port)),
        [],
      );
      checks.push(
        'Malformed, authority-spoofing and decompression-bomb links reject without publisher or receiver requests',
      );

      const shareURL = await createShareURL(recipe, managerURL);
      await page.goto(shareURL);
      await ready(page);
      assert.equal(await page.locator('#install').count(), 0);
      assert.deepEqual(
        server.traffic
          .slice(start)
          .filter((request) => ![4210, 4211, 4219].includes(request.port)),
        [],
      );
      await page
        .getByText('Includes 1 additional resource URL', { exact: true })
        .waitFor();
      await mkdir('results/screenshots/share-links', { recursive: true });
      await page.screenshot({
        path: `results/screenshots/share-links/${name}-landing.png`,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      );
      await page.screenshot({
        path: `results/screenshots/share-links/${name}-narrow.png`,
      });
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.getByRole('button', { name: 'Install & open', exact: true }).click();
      await page.waitForURL('http://127.0.0.1:4211/runtime/**', { waitUntil: 'commit' });
      await page.getByText('Data document', { exact: true }).waitFor();
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
      checks.push(
        'One click installs the explicit resource list and opens a working local document in the same tab, preserving launch queries',
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
        'Installed application cannot send a receiver request; server traffic and a working unrestricted control confirm confinement',
      );

      await page.goto(shareURL);
      await ready(page);
      const beforeOpen = server.traffic.length;
      await page.getByRole('link', { name: 'Open', exact: true }).click();
      await page.getByText('Data document', { exact: true }).waitFor();
      assert.deepEqual(
        server.traffic.slice(beforeOpen).filter((request) => request.port === 4218),
        [],
      );
      checks.push('An existing installation opens without publisher downloads');

      await page.evaluate(() =>
        localStorage.setItem('share-private-marker', 'kept locally'),
      );
      await page.goto(shareURL);
      await ready(page);
      const reinstallStart = server.traffic.length;
      await page.getByRole('button', { name: 'Reinstall & open', exact: true }).click();
      await page.getByText('Data document', { exact: true }).waitFor();
      assert(
        server.traffic.slice(reinstallStart).some((request) => request.port === 4218),
      );
      assert.equal(
        await page.evaluate(() => localStorage.getItem('share-private-marker')),
        'kept locally',
      );
      checks.push(
        'Explicit reinstall downloads again, opens the app and preserves its private storage',
      );

      await page.goto(managerURL);
      await ready(page);
      await fallbackClipboard(page);
      const card = page.locator('.app-card');
      await card.getByRole('button', { name: 'Copy link', exact: true }).click();
      const copied = await card
        .getByRole('textbox', { name: 'Share link', exact: true })
        .inputValue();
      assert.deepEqual(await readShareHash(new URL(copied).hash), recipe);
      await page.setViewportSize({ width: 390, height: 844 });
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      );
      await page.screenshot({
        path: `results/screenshots/share-links/${name}-library-narrow.png`,
      });
      await page.setViewportSize({ width: 1280, height: 720 });
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
      const clipboard = await page.evaluate(() => Reflect.get(window, 'copiedLink'));
      assert.equal(clipboard, copied);
      checks.push(
        'Library link copying includes the installed resolved resource list, with successful clipboard feedback and a selectable fallback',
      );

      const recipient = await browser.newContext();
      try {
        const fresh = await recipient.newPage();
        await fresh.goto(copied);
        await ready(fresh);
        await fresh.getByRole('button', { name: 'Install & open', exact: true }).click();
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
      checks.push('A library link installs and opens in a fresh browser storage context');

      // Changing a hash in an already-open manager must parse the new recipe.
      await page.evaluate((hash) => {
        location.hash = hash;
      }, new URL(copied).hash);
      await page.getByRole('link', { name: 'Open', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Back to library', exact: true }).click();
      await page.locator('#app-url').waitFor();
      assert.equal(new URL(page.url()).hash, '');

      // Form sharing includes an uploaded list rather than the catalog default.
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
      const uploadedLink = await page
        .getByRole('textbox', { name: 'Share link', exact: true })
        .inputValue();
      assert.deepEqual(await readShareHash(new URL(uploadedLink).hash), recipe);
      checks.push(
        'Hash navigation and return to library work; a form share embeds uploaded list contents',
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
      await page.goto(compressedLink);
      await ready(page);
      await page
        .getByText('Includes 300 additional resource URLs', { exact: true })
        .waitFor();
      checks.push(
        'Browser-generated compressed lists decode into the complete recipient recipe',
      );

      await page.goto(
        await createShareURL({ url: 'http://127.0.0.1:4212/' }, managerURL),
      );
      await ready(page);
      assert.equal(await page.locator('details').count(), 0);
      checks.push('A URL-only shared recipe does not inherit a catalog resource list');

      // A URL without a list remains a URL-only recipe.
      const noListLink = await createShareURL({ url: source + '&list=none' }, managerURL);
      await page.goto(noListLink);
      await ready(page);
      await page.getByRole('button', { name: 'Install & open', exact: true }).click();
      await page.getByText('Data document', { exact: true }).waitFor();
      checks.push('An application URL without a resource list installs and opens');

      // URL lists are fetched only after the recipient chooses to install.
      const urlListLink = await createShareURL(
        {
          url: 'http://127.0.0.1:4212/',
          resourceList: { kind: 'url', url: 'http://127.0.0.1:4212/resource-list.uris' },
        },
        managerURL,
      );
      const listStart = server.traffic.length;
      await page.goto(urlListLink);
      await ready(page);
      assert.deepEqual(
        server.traffic.slice(listStart).filter((request) => request.port === 4212),
        [],
      );
      await page.getByRole('button', { name: 'Install & open', exact: true }).click();
      await page.waitForURL('http://127.0.0.1:4211/runtime/**', { waitUntil: 'commit' });
      await page.locator('#note').waitFor();
      assert(
        server.traffic
          .slice(listStart)
          .some(
            (request) => request.port === 4212 && request.path === '/resource-list.uris',
          ),
      );
      checks.push(
        'A remote resource list downloads through the installer after the click and opens the Notes application',
      );

      // Download failures stay on the landing page and expose a retry action.
      const missingLink = await createShareURL(
        {
          url: source,
          resourceList: {
            kind: 'text',
            text: 'http://127.0.0.1:4218/missing-share-resource.js',
          },
        },
        managerURL,
      );
      await page.goto(missingLink);
      await ready(page);
      await page.getByRole('button', { name: 'Install & open', exact: true }).click();
      await page
        .getByRole('status')
        .filter({ hasText: 'Installation refused:' })
        .waitFor();
      assert.equal(page.url(), missingLink);
      assert(
        await page
          .getByRole('button', { name: 'Install & open', exact: true })
          .isEnabled(),
      );
      checks.push(
        'A missing explicit resource refuses installation and leaves the recipe available for retry',
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
