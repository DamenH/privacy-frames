import { launch } from './browser-profile.ts';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import { servers } from './server.ts';
// Mutating browser prototypes must not expose a private native token list through
// the read-only relList interface. The unrestricted page runs the same probe.
function tokenListReceiverProbe() {
  const link = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"]');
  if (!link) throw new Error('Stylesheet control is missing');
  const list = link.relList;
  const prototype = DOMTokenList.prototype;
  const keys = [
    'supports',
    'contains',
    'item',
    Symbol.iterator,
    'length',
    'value',
  ] as const;
  const descriptors = new Map(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(prototype, key)!]),
  );
  const receivers: Array<{ key: string; receiver: DOMTokenList }> = [];
  const nativeAdd = prototype.add;
  const nativeRemove = prototype.remove;
  try {
    for (const key of keys) {
      const original = descriptors.get(key)!;
      const label = typeof key === 'symbol' ? 'iterator' : key;
      const intercept = function (this: DOMTokenList, ...args: unknown[]) {
        receivers.push({ key: label, receiver: this });
        return Reflect.apply(original.get ?? original.value, this, args);
      };
      Object.defineProperty(
        prototype,
        key,
        original.get
          ? { ...original, get: intercept }
          : { ...original, value: intercept },
      );
    }
    const behavior = {
      supports: list.supports('stylesheet'),
      contains: list.contains('stylesheet'),
      item: list.item(0),
      length: list.length,
      value: list.value,
      string: list.toString(),
      tokens: [...list],
    };
    let receiverCanMutate = false;
    if (receivers.length) {
      Reflect.apply(nativeAdd, receivers[0].receiver, ['receiver-control']);
      receiverCanMutate = link.rel.includes('receiver-control');
      Reflect.apply(nativeRemove, receivers[0].receiver, ['receiver-control']);
    }
    let mutationBlocked = false;
    try {
      list.add('receiver-control');
    } catch {
      mutationBlocked = true;
    }
    if (!mutationBlocked) Reflect.apply(nativeRemove, list, ['receiver-control']);
    return {
      replacedProperties: descriptors.size,
      receivers: receivers.length,
      interceptedProperties: [...new Set(receivers.map(({ key }) => key))].sort(),
      receiverCanMutate,
      mutationBlocked,
      behavior,
    };
  } finally {
    for (const [key, descriptor] of descriptors)
      Object.defineProperty(prototype, key, descriptor);
  }
}

const server = await servers();
const results = { date: new Date().toISOString(), browsers: [] };
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine, { headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    // Test-only capability captured before setup, to attack the worker's independent
    // client authorization even if the application's JavaScript gate were bypassed.
    await context.addInitScript(() => {
      if (!/\/[A-Za-z0-9_-]{11}\//.test(location.pathname)) return;
      const controller = navigator.serviceWorker.controller,
        post = ServiceWorker.prototype.postMessage,
        apply = Reflect.apply;
      Object.defineProperty(window, '__boundaryWorkerProbe', {
        value: (operation, payload) =>
          new Promise((resolve) => {
            const channel = new MessageChannel();
            channel.port1.onmessage = (e) => {
              channel.port1.close();
              resolve(e.data);
            };
            apply(post, controller, [
              { operation, payload, claimedClient: 'manager' },
              [channel.port2],
            ]);
          }),
      });
    });
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    const result = { name, version: browser.version(), checks: [], errors };
    results.browsers.push(result);
    try {
      await page.goto('http://127.0.0.1:4210/privacy-frames/');
      await page.getByText('Ready to install.', { exact: false }).waitFor();
      for (const [id, port] of [
        ['notes', 4212],
        ['image', 4213],
        ['adversary', 4215],
        ['playground', 4217],
      ]) {
        await page.locator('#app-url').fill(`http://127.0.0.1:${port}/`);
        await page.locator('#install button').click();
        await page.locator(`[data-app="${id}"]`).waitFor();
      }
      assert.equal(await page.locator('.app-card').count(), 4);
      await page.reload();
      await page.locator('[data-app="adversary"]').waitFor();
      assert.equal(await page.locator('iframe').count(), 1);
      await page.evaluate(() => {
        window.name = 'privacy-host-manager';
      });
      result.checks.push('Four websites installed from distinct origins');
      async function launch(id) {
        const popup = context.waitForEvent('page');
        await page.locator(`[data-app="${id}"]`).click();
        const p = await popup;
        p.on('pageerror', (e) => errors.push(`${id}: ${e.message}`));
        p.on('console', (m) => {
          if (m.type() === 'error') errors.push(`${id}: ${m.text()}`);
        });
        await p.waitForLoadState();
        await p.locator('[data-host-ready="true"]').waitFor();
        await p.waitForFunction(() =>
          document.querySelector('#mode')?.textContent.includes('network isolated'),
        );
        return p;
      }
      let app = await launch('notes');
      assert.equal(await app.evaluate(() => window.opener), null);
      await app.locator('#note').fill('A private diagnostic note');
      await app.locator('#save').click();
      await app.reload();
      await app.waitForFunction(() =>
        document.querySelector('#mode')?.textContent.includes('network isolated'),
      );
      assert.equal(await app.locator('#note').inputValue(), 'A private diagnostic note');
      await app.close();
      result.checks.push('Native notes editing, per-app persistence, reload, no opener');
      app = await launch('image');
      const before = await app.evaluate(() =>
        Array.from(
          document.querySelector('canvas').getContext('2d').getImageData(0, 0, 1, 1).data,
        ),
      );
      await app.locator('#invert').click();
      const after = await app.evaluate(() =>
        Array.from(
          document.querySelector('canvas').getContext('2d').getImageData(0, 0, 1, 1).data,
        ),
      );
      assert.equal(after[0], 255 - before[0]);
      await app
        .locator('#file')
        .setInputFiles(new URL('./pixels.png', import.meta.url).pathname);
      await app.waitForFunction(() => document.querySelector('canvas').width === 2);
      const uploaded = await app.evaluate(() =>
        Array.from(
          document.querySelector('canvas').getContext('2d').getImageData(0, 0, 1, 1).data,
        ),
      );
      assert.deepEqual(uploaded, [220, 40, 90, 255]);
      await app.close();
      result.checks.push('Local file input, canvas pixel access and transformation');
      app = await launch('notes');
      await app
        .getByText('Article loaded using native fetch.', { exact: true })
        .waitFor();
      assert(
        await app
          .locator('#illustration')
          .evaluate((img) => img.complete && img.naturalWidth > 0),
      );
      const aliases = await app.evaluate(async () => {
        const original = 'http://127.0.0.1:4212/article.json';
        const fetched = await (await fetch(original)).json();
        const xhr = await new Promise((resolve, reject) => {
          const request = new XMLHttpRequest();
          request.open('GET', original);
          request.onload = () => resolve(JSON.parse(request.responseText));
          request.onerror = reject;
          request.send();
        });
        const cache = await caches.open('original-urls');
        await cache.add(original);
        const cached = await (await cache.match(original)).json();
        const image = new Image();
        image.src = 'http://127.0.0.1:4212/cover.svg';
        await image.decode();
        return {
          same:
            JSON.stringify(fetched) === JSON.stringify(xhr) &&
            JSON.stringify(xhr) === JSON.stringify(cached),
          image: image.naturalWidth > 0,
          localImage: new URL(image.src).origin === location.origin,
        };
      });
      assert.deepEqual(aliases, { same: true, image: true, localImage: true });
      result.checks.push(
        'Original publisher URLs map locally for fetch, XHR, Cache.add and images under runtime-only CSP',
      );
      await app.locator('#external').click();
      await app.getByText('Uninstalled URL blocked.', { exact: true }).waitFor();
      await app.close();
      result.checks.push('Native fetch and installed image, external fetch refused');
      app = await launch('adversary');
      const hostURL = page.url(),
        originalAppURL = app.url();
      const appOrigin = await app.evaluate(() => location.origin);
      assert.notEqual(appOrigin, new URL(hostURL).origin);
      const managerCanary = 'host-private-canary-' + name;
      const runtimeBridge = page
        .frames()
        .find((frame) => frame.url().endsWith('/connect.html'));
      assert(runtimeBridge);
      await app.evaluate(() => {
        window.storageObservations = [];
        addEventListener('storage', (event) =>
          storageObservations.push({
            key: event.key,
            value: event.newValue,
            raw: event.storageArea?.['manager-secret'],
            keys: Object.keys(event.storageArea || {}),
          }),
        );
      });
      await runtimeBridge.evaluate((value) => {
        localStorage.setItem('manager-secret', value);
        sessionStorage.setItem('manager-session', value);
      }, managerCanary);
      await app.waitForTimeout(100);
      assert.deepEqual(
        await app.evaluate(() => storageObservations),
        [],
        'Manager storage event reached application',
      );
      const installation = await page
        .locator('[data-app="adversary"]')
        .getAttribute('data-installation');
      await runtimeBridge.evaluate(
        ({ installation }) => {
          localStorage.setItem(`pf:${installation}:event-test`, 'same-app-value');
        },
        { installation },
      );
      await app.waitForFunction(() => storageObservations.length === 1);
      assert.deepEqual(await app.evaluate(() => storageObservations[0]), {
        key: 'event-test',
        value: 'same-app-value',
        raw: undefined,
        keys: ['event-test'],
      });
      await runtimeBridge.evaluate(() => localStorage.clear());
      await app.waitForTimeout(100);
      assert.equal(
        await app.evaluate(() => storageObservations.length),
        1,
        'Native whole-origin clear event reached application',
      );
      await runtimeBridge.evaluate(
        (value) => localStorage.setItem('manager-secret', value),
        managerCanary,
      );
      result.checks.push(
        'Storage events hide foreign namespaces and expose only scoped storage references',
      );
      const raw = await app.evaluate(async () => {
        const getAttempts = [];
        for (const [object, key] of [
          [window, 'indexedDB'],
          [window, 'caches'],
          [navigator, 'serviceWorker'],
        ]) {
          for (let proto = object; proto; proto = Object.getPrototypeOf(proto)) {
            const d = Object.getOwnPropertyDescriptor(proto, key);
            if (!d?.get) continue;
            try {
              const value = Reflect.apply(d.get, object, []);
              getAttempts.push({ key, denied: false, type: typeof value });
            } catch {
              getAttempts.push({ key, denied: true });
            }
          }
        }
        return {
          local: localStorage.getItem('manager-secret'),
          session: sessionStorage.getItem('manager-session'),
          enumerated: Object.keys(localStorage),
          getAttempts,
        };
      });
      assert.equal(raw.local, null);
      assert.equal(raw.session, null);
      assert(!raw.enumerated.includes('manager-secret'));
      assert(
        raw.getAttempts.length >= 3 &&
          raw.getAttempts.every((x) =>
            x.key === 'serviceWorker' ? x.denied : !x.denied,
          ),
      );
      await app.evaluate(() => {
        localStorage.setItem('manager-secret', 'attacker-value');
        localStorage.clear();
      });
      assert.equal(
        await runtimeBridge.evaluate(() => localStorage.getItem('manager-secret')),
        managerCanary,
      );
      for (const file of [
        'index.html',
        'manager.js',
        'config.json',
        'report.html',
        'sw.js',
      ]) {
        const denied = await app.evaluate(async (url) => {
          try {
            await fetch(url);
            return false;
          } catch {
            return true;
          }
        }, new URL(file, hostURL).href);
        assert(denied, 'App fetched host ' + file);
      }
      for (const operation of ['list', 'events', 'remove', 'install']) {
        const response = await app.evaluate(
          ({ operation, id }) => __boundaryWorkerProbe(operation, id),
          {
            operation,
            id: await page
              .locator('[data-app="notes"]')
              .getAttribute('data-installation'),
          },
        );
        assert.equal(response.ok, false);
        assert.match(response.error, /not authorized/);
      }
      const spoof = await app.evaluate((url) => {
        try {
          history.replaceState({}, '', url);
          return false;
        } catch {
          return true;
        }
      }, hostURL);
      assert(spoof);
      assert.equal(app.url(), originalAppURL);
      await app.evaluate((url) => {
        const a = document.createElement('a');
        a.href = url + '?unexpected-navigation=1';
        a.target = 'privacy-host-manager';
        document.body.append(a);
        try {
          a.click();
        } catch {}
      }, hostURL);
      await app.waitForTimeout(100);
      assert.equal(page.url(), hostURL);
      assert.equal(app.url(), originalAppURL);
      assert.equal(await app.evaluate(() => window.opener), null);
      result.runtimeIsolation = {
        origin: appOrigin,
        hostStorageProtected: true,
        prototypeGetterChecks: raw.getAttempts.length,
        hostResourcesDenied: true,
        workerManagementDenied: true,
        identitySpoofDenied: true,
        managerWindowTargetDenied: true,
      };
      result.checks.push(
        'Cross-origin manager and same-runtime host state, resources, prototype getters, management and URL identity protected',
      );
      const tokenListIsolation = await app.evaluate(tokenListReceiverProbe);
      assert.equal(tokenListIsolation.replacedProperties, 6);
      assert.equal(tokenListIsolation.receivers, 0, JSON.stringify(tokenListIsolation));
      assert.equal(tokenListIsolation.receiverCanMutate, false);
      assert.equal(tokenListIsolation.mutationBlocked, true);
      assert.deepEqual(tokenListIsolation.behavior, {
        supports: true,
        contains: true,
        item: 'stylesheet',
        length: 1,
        value: 'stylesheet',
        string: 'stylesheet',
        tokens: ['stylesheet'],
      });
      result.tokenListIsolation = tokenListIsolation;
      result.checks.push(
        'Read-only link token lists retain native behavior without exposing their receiver through mutable browser prototypes',
      );
      const names = await app.evaluate(() => Object.keys(window.boundaryProbes));
      const probes = [];
      for (const probe of names.filter(
        (n) => !['eval', 'Function constructor'].includes(n),
      )) {
        const observation = await app.evaluate(async (name) => {
          const before = window.length;
          try {
            const value = await window.boundaryProbes[name]();
            return {
              name,
              blocked: false,
              value: typeof value,
              contexts: window.length - before,
            };
          } catch (e) {
            return {
              name,
              blocked: true,
              error: e.name,
              contexts: window.length - before,
            };
          }
        }, probe);
        probes.push(observation);
        assert(observation.blocked, `${name}: ${probe} was allowed`);
        assert.equal(observation.contexts, 0, `${probe}: context created`);
      }
      await app.locator('#run').click();
      await app.waitForFunction(
        () =>
          document.querySelector('#results').children.length ===
          Object.keys(boundaryProbes).length,
      );
      const uiResults = await app.locator('#results tr').allTextContents();
      assert(
        uiResults.every((text) => text.includes('Blocked:')),
        `Unblocked real-event probe: ${uiResults.filter((text) => !text.includes('Blocked:'))}`,
      );
      result.uiProbes = uiResults;
      result.probes = probes;
      const start = server.traffic.length,
        connectionStart = server.connections.length;
      await app.locator('#diagnostic').fill('private-marker-' + name);
      await app.locator('#network').click({ noWaitAfter: true });
      await app.waitForFunction(() =>
        document
          .querySelector('#status')
          ?.textContent.startsWith('Fetch and XHR rejected.'),
      );
      await app.waitForTimeout(300);
      const escaped = server.traffic
        .slice(start)
        .filter((x) => x.path.includes('private-marker'));
      assert.deepEqual(escaped, [], 'Runtime marker reached network');
      const collectorConnections = server.connections
        .slice(connectionStart)
        .filter((x) => x.port === 4216);
      assert.deepEqual(
        collectorConnections,
        [],
        'Runtime opened receiver TCP connection',
      );
      result.receiver = {
        httpRequests: escaped.length,
        tcpConnections: collectorConnections.length,
      };
      result.checks.push(
        'Fetch, XHR, image, CSS, link ping, form, location and socket disclosure attempts produced no marker at HTTP receivers',
      );
      await app.close();
      result.checks.push(
        `${probes.length} context/authority/tampering probes refused before creating children`,
      );
      const baseline = await context.newPage();
      await baseline.goto('http://127.0.0.1:4215/');
      const tokenListControl = await baseline.evaluate(tokenListReceiverProbe);
      assert.equal(tokenListControl.replacedProperties, 6);
      assert(tokenListControl.receivers >= 6);
      assert.deepEqual(tokenListControl.interceptedProperties, [
        'contains',
        'item',
        'iterator',
        'length',
        'supports',
        'value',
      ]);
      assert.equal(tokenListControl.receiverCanMutate, true);
      assert.equal(tokenListControl.mutationBlocked, false);
      assert.deepEqual(tokenListControl.behavior, tokenListIsolation.behavior);
      result.tokenListControl = tokenListControl;
      result.controls = [];
      for (const probe of [
        'createElement iframe',
        'createElementNS iframe',
        'innerHTML iframe',
        'insertAdjacentHTML iframe',
        'outerHTML iframe',
        'template parser',
        'Shadow DOM parser',
        'Range parser',
        'DOMParser import',
        'Audio worklet',
      ]) {
        const value = await baseline.evaluate(async (name) => {
          try {
            return { ok: !!(await boundaryProbes[name]()), frames: window.length };
          } catch (e) {
            return { ok: false, error: e.message };
          }
        }, probe);
        result.controls.push({ name: probe, ...value });
        assert(value.ok, `${name}: inactive ${probe} control`);
      }
      const controlStart = server.traffic.length;
      await baseline.locator('#diagnostic').fill('control-marker-' + name);
      await baseline
        .locator('#network')
        .click({ noWaitAfter: true })
        .catch(() => {});
      await baseline.waitForTimeout(300);
      const networkControl = server.traffic
        .slice(controlStart)
        .filter((x) => x.path.includes('control-marker'));
      assert(
        networkControl.some((x) => x.port === 4216),
        'Inactive HTTP network control',
      );
      result.networkControl = networkControl;
      await baseline.close();
      result.checks.push('Ten unrestricted context/agent creation controls active');
      app = await launch('playground');
      const playgroundStart = server.traffic.length;
      await app.locator('#secret').fill('private-playground-marker');
      await app.locator('#run').click();
      await app.waitForFunction(() =>
        document.querySelector('#output').textContent.includes('BLOCKED:'),
      );
      assert(!server.traffic.slice(playgroundStart).some((x) => x.port === 4216));
      assert(
        (await app.locator('#output').textContent()).includes(
          'private-playground-marker',
        ),
      );
      await app.locator('#html').fill('<h2 id="edited">Edited preview</h2>');
      await app.locator('#css').fill('h2 { color: rgb(120, 200, 140); }');
      await app
        .locator('#javascript')
        .fill(
          'preview.querySelector("#edited").textContent = "JavaScript ran"; log("EDITED SCRIPT RAN");',
        );
      await app.locator('#run').click();
      await app.waitForFunction(() =>
        document.querySelector('#output').textContent.includes('EDITED SCRIPT RAN'),
      );
      assert.equal(
        await app
          .locator('#preview')
          .evaluate((e) => e.shadowRoot.querySelector('h2').textContent),
        'JavaScript ran',
      );
      assert.equal(await app.evaluate(() => window.length), 0);
      await app
        .locator('#javascript')
        .fill('document.body.append(document.createElement("iframe"));');
      await app.locator('#run').click();
      await app.waitForFunction(() =>
        document.querySelector('#output').textContent.includes('ERROR:'),
      );
      assert.equal(await app.evaluate(() => window.length), 0);
      await app
        .locator('#javascript')
        .fill(
          `const a = document.createElement('a'); a.href = "javascript:window.__jsurlEscape=1;'<h1>escape</h1>'"; document.body.append(a); a.click(); log('JS URL ATTEMPTED');`,
        );
      await app.locator('#run').click({ noWaitAfter: true });
      await app.waitForFunction(() =>
        document.querySelector('#output').textContent.includes('JS URL ATTEMPTED'),
      );
      assert.equal(await app.evaluate(() => window.__jsurlEscape), undefined);
      assert.equal(await app.locator('#javascript').count(), 1);
      await app.close();
      const playgroundBaseline = await context.newPage();
      await playgroundBaseline.goto('http://127.0.0.1:4217/');
      const baselineStart = server.traffic.length;
      await playgroundBaseline.locator('#run').click();
      await playgroundBaseline.waitForFunction(() =>
        document.querySelector('#output').textContent.includes('NETWORK REACHED'),
      );
      assert(server.traffic.slice(baselineStart).some((x) => x.port === 4216));
      await playgroundBaseline.close();
      result.checks.push(
        'Editable HTML/CSS/JS playground blocks default disclosure, runs edited scripts in place and retains context guards; unrestricted control transmits',
      );
      // A failed download must not publish an installation.
      await page.locator('#app-url').fill('http://127.0.0.1:4212/broken/');
      await page.locator('#install button').click();
      await page.waitForFunction(() =>
        document.querySelector('#status').textContent.startsWith('Installation refused:'),
      );
      assert.equal(await page.locator('.app-card').count(), 4);
      result.checks.push('Incomplete installation refused atomically');
      // Open-window replacement must fail, and a different source cannot inherit note data.
      const originalNoteURL = await page
        .locator('[data-app="notes"]')
        .first()
        .getAttribute('href');
      const active = await launch('notes');
      await page.locator('#app-url').fill('http://127.0.0.1:4212/');
      await page.locator('#install button').click();
      await page.waitForFunction(() =>
        document
          .querySelector('#status')
          .textContent.includes('Close application windows'),
      );
      await active.close();
      await page.locator('#app-url').fill('http://127.0.0.1:4214/');
      await page.locator('#install button').click();
      await page.waitForFunction(
        () => document.querySelectorAll('.app-card').length === 5,
      );
      const noteLinks = page.locator('[data-app="notes"]');
      assert.equal(await noteLinks.count(), 2);
      const copyLink = noteLinks.nth(
        (await noteLinks.nth(0).getAttribute('href')) === originalNoteURL ? 1 : 0,
      );
      assert.notEqual(await copyLink.getAttribute('href'), originalNoteURL);
      const opened = context.waitForEvent('page');
      await copyLink.click();
      const copy = await opened;
      await copy.waitForFunction(() =>
        document.querySelector('#mode')?.textContent.includes('network isolated'),
      );
      assert.equal(await copy.locator('#note').inputValue(), '');
      await copy.evaluate(async () => {
        try {
          await fetch(new URL('/uninstalled-diagnostic-marker', location.origin));
          throw new Error('Uninstalled local request was admitted');
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === 'Uninstalled local request was admitted'
          )
            throw error;
        }
      });
      await page.locator('.observations summary').click();
      await page.locator('#refresh-events').click();
      await page.waitForFunction(() =>
        document
          .querySelector('#events')
          .textContent.includes('uninstalled-diagnostic-marker'),
      );
      await copy.close();
      result.checks.push(
        'Open-window update rejected; identical application labels at different sources get isolated storage',
      );
      // Missing enforcement support refuses entry before private input or app scripts.
      await context.addInitScript(() => {
        if (/\/[A-Za-z0-9_-]{11}\//.test(location.pathname))
          Object.defineProperty(window, 'navigation', {
            value: undefined,
            configurable: true,
          });
      });
      const faultPopup = context.waitForEvent('page');
      await page.locator('[data-app="notes"]').first().click();
      const refused = await faultPopup;
      await refused.getByText('Application refused', { exact: true }).waitFor();
      assert.equal(await refused.locator('#note').count(), 0);
      assert.equal(await refused.evaluate(() => typeof window.privacyHost), 'undefined');
      await refused.close();
      result.checks.push(
        'Unavailable Navigation API refuses startup before application input or execution',
      );
      const fresh = await browser.newContext();
      const uncontrolled = await fresh.newPage();
      const missing = await uncontrolled.goto(
        await page.locator('[data-app="notes"]').first().getAttribute('href'),
      );
      assert.equal(missing.status(), 404);
      assert.equal(await uncontrolled.locator('#note').count(), 0);
      await fresh.close();
      result.checks.push(
        'Uncontrolled virtual runtime URL serves 404 without application code',
      );
    } catch (error) {
      result.failure = error.stack;
      throw error;
    } finally {
      await context.close();
      await browser.close();
    }
  }
} finally {
  await server.close();
  await writeFile(
    new URL('../results/browser.json', import.meta.url),
    JSON.stringify(results, null, 2) + '\n',
  );
}
console.log(
  results.browsers
    .map(
      (r) =>
        `${r.name} ${r.version}: ${r.checks.length} groups passed, ${r.probes.length} direct and ${r.uiProbes.length} real-event probes`,
    )
    .join('\n'),
);
