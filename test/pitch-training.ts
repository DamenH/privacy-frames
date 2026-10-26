import { launch } from './browser-profile.ts';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium, firefox } from 'playwright';
import { servers } from './server.ts';
const temporary = await mkdtemp(join(tmpdir(), 'pf-audio-')),
  tone = join(temporary, '220hz.wav');
const frames = 44100 * 4,
  wav = Buffer.alloc(44 + frames * 2);
wav.write('RIFF', 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(44100, 24);
wav.writeUInt32LE(88200, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(frames * 2, 40);
for (let i = 0; i < frames; i++)
  wav.writeInt16LE(
    Math.round(12000 * Math.sin((2 * Math.PI * 220 * i) / 44100)),
    44 + i * 2,
  );
await writeFile(tone, wav);
const deployed = !!process.env.HOST_URL,
  hostURL = process.env.HOST_URL || 'http://127.0.0.1:4210/privacy-frames/';
const server = deployed ? { traffic: [], close: async () => {} } : await servers(),
  results = [];
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(
        engine,
        name === 'chromium'
          ? {
              executablePath: chromium.executablePath(),
              args: [
                '--use-fake-device-for-media-stream',
                `--use-file-for-fake-audio-capture=${tone}`,
              ],
            }
          : {
              firefoxUserPrefs: {
                'media.navigator.streams.fake': true,
                'media.navigator.permission.disabled': true,
              },
            },
      ),
      context = await browser.newContext(),
      manager = await context.newPage();
    let runtimeOrigin;
    const checks = [],
      errors = [],
      policyObservations = [];
    let app;
    try {
      await manager.goto(hostURL);
      await manager.locator('#refresh-apps').waitFor();
      await manager.getByText('Ready to install.', { exact: true }).waitFor();
      await manager.locator('#app-url').fill('https://damenh.github.io/pitch-training/');
      await manager.locator('#install button').click();
      await manager.waitForFunction(
        () =>
          /^(Installed |Installation refused:)/.test(
            document.querySelector('#status').textContent,
          ),
        {},
        { timeout: 90000 },
      );
      assert.match(await manager.locator('#status').textContent(), /^Installed /);
      const installation = await manager
        .locator('[data-app="pitch-training"]')
        .getAttribute('data-installation');
      const installer = manager
        .frames()
        .find((frame) => new URL(frame.url()).pathname.endsWith('/connect.html'));
      runtimeOrigin = new URL(installer.url()).origin;
      if (name === 'chromium')
        await context.grantPermissions(['microphone'], { origin: runtimeOrigin });
      const executableReceipt = await installer.evaluate(
        (id) =>
          new Promise((resolve, reject) => {
            const request = indexedDB.open('privacy-frames-installations', 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result,
                tx = db.transaction('installations'),
                read = tx.objectStore('installations').get(id);
              tx.oncomplete = () => {
                resolve(
                  read.result.resources
                    .filter((resource) => /\.m?js$/.test(resource.path))
                    .map((resource) => ({ url: resource.url, sha256: resource.sha256 })),
                );
                db.close();
              };
            };
          }),
        installation,
      );
      for (const resource of executableReceipt) {
        const response = await fetch(resource.url);
        assert(response.ok);
        assert.equal(
          createHash('sha256')
            .update(Buffer.from(await response.arrayBuffer()))
            .digest('hex'),
          resource.sha256,
          'Published executable bytes were changed',
        );
      }
      const opened = context.waitForEvent('page');
      await manager.locator('[data-app="pitch-training"]').click();
      app = await opened;
      app.on('pageerror', (e) => errors.push(e.message));
      app.on('console', (message) => {
        if (message.type() === 'error') {
          const text = message.text(),
            url = message.location().url;
          if (
            /favicon\.ico(?:$|[?])/.test(url) ||
            /favicon\.ico/.test(text) ||
            (/guard\.js/.test(text) && /Content-Security-Policy/.test(text))
          )
            policyObservations.push({ text, url });
          else errors.push(text);
        }
      });
      await app.bringToFront();
      await app.getByRole('navigation', { name: 'Main', exact: true }).waitFor();
      checks.push(
        'Original public URL installs without a host manifest or application source changes and renders Svelte UI',
      );
      const worker = await app.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        let updateDenied = false;
        try {
          await registration.update();
        } catch (e) {
          updateDenied = e.name === 'NotSupportedError';
        }
        return {
          state: registration.active.state,
          updateDenied,
          script: registration.active.scriptURL,
        };
      });
      assert.equal(worker.state, 'activated');
      assert.equal(worker.updateDenied, true);
      checks.push(
        'Completed installation is available through mediated worker readiness; unsupported updates reject',
      );
      await app.evaluate(() => {
        window.audioProbe = [];
        window.captureProbe = [];
        window.captureErrors = [];
        const start = AudioBufferSourceNode.prototype.start;
        AudioBufferSourceNode.prototype.start = function (...args) {
          const data = this.buffer?.getChannelData(0);
          let energy = 0;
          if (data) for (let i = 0; i < data.length; i++) energy += data[i] * data[i];
          audioProbe.push({
            frames: data?.length || 0,
            energy,
            state: this.context.state,
          });
          return Reflect.apply(start, this, args);
        };
        const capture = MediaDevices.prototype.getUserMedia;
        MediaDevices.prototype.getUserMedia = async function (...args) {
          try {
            const stream = await Reflect.apply(capture, this, args);
            captureProbe.push(stream);
            return stream;
          } catch (e) {
            captureErrors.push({ name: e.name, message: e.message });
            throw e;
          }
        };
      });
      const networkStart = server.traffic.length;
      await app.getByRole('button', { name: 'Play note', exact: true }).click();
      await app.waitForFunction(() =>
        audioProbe.some((p) => p.frames > 1000 && p.energy > 0 && p.state === 'running'),
      );
      await app.getByRole('button', { name: 'C', exact: true }).click();
      await app.getByRole('button', { name: 'Submit answer', exact: true }).click();
      const savedHistory = await app.evaluate(() => {
        const key = Object.keys(localStorage).find((k) => k.endsWith('history/v1'));
        return key ? JSON.parse(localStorage.getItem(key)) : null;
      });
      assert(savedHistory?.length > 0);
      checks.push(
        'Installed piano samples decode into nonzero buffers and play in a running audio context; exercise records history',
      );
      async function tab(label) {
        await app
          .getByRole('navigation', { name: 'Main', exact: true })
          .getByRole('link', { name: label, exact: true })
          .click();
      }
      await tab('Reference');
      await app.getByRole('button', { name: 'Load C major scale', exact: true }).click();
      await app
        .getByRole('textbox', { name: 'Piece title', exact: true })
        .fill('Private test score');
      await app.getByRole('button', { name: 'Save to library', exact: true }).click();
      await app
        .getByRole('button', { name: 'Private test score', exact: true })
        .waitFor();
      const scoreRecords = await app.evaluate(async () => {
        const info = (await indexedDB.databases()).find((db) =>
          db.name.endsWith('piano-library'),
        );
        if (!info) return [];
        return new Promise((resolve, reject) => {
          const request = indexedDB.open(info.name);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result,
              tx = db.transaction('scores'),
              read = tx.objectStore('scores').getAll();
            tx.oncomplete = () => {
              resolve(read.result.map((entry) => entry.score.title));
              db.close();
            };
          };
        });
      });
      assert.deepEqual(
        scoreRecords,
        ['Private test score'],
        'Score silently fell back instead of using IndexedDB',
      );
      await app.getByRole('button', { name: 'Start microphone', exact: true }).click();
      await app.waitForFunction(() => captureProbe.length || captureErrors.length);
      assert.deepEqual(await app.evaluate(() => captureErrors), []);
      await app.getByText('Microphone on', { exact: true }).waitFor();
      await app.waitForFunction(
        () =>
          /\d+\.\d Hz/.test(
            document.querySelector('.meter .detected .sub')?.textContent || '',
          ),
        {},
        { timeout: 20000 },
      );
      const frequency = Number(
        (await app.locator('.meter .detected .sub').textContent()).match(
          /([\d.]+) Hz/,
        )[1],
      );
      if (name === 'chromium')
        assert(
          Math.abs(frequency - 220) < 3,
          `Controlled 220 Hz audio detected as ${frequency}`,
        );
      else assert(frequency > 100 && frequency < 2000);
      await app.getByRole('button', { name: 'Stop', exact: true }).click();
      assert(
        await app.evaluate(
          () =>
            captureProbe.length === 1 &&
            captureProbe[0].getTracks().every((track) => track.readyState === 'ended'),
        ),
      );
      checks.push(
        'Native microphone input reaches pitch analysis and capture stops; ' +
          frequency +
          ' Hz detected',
      );
      if (name === 'chromium') {
        await context.clearPermissions();
        await context.grantPermissions([], { origin: runtimeOrigin });
        await app.getByRole('button', { name: 'Start microphone', exact: true }).click();
        await app.getByText('Microphone unavailable.', { exact: false }).waitFor();
        assert.equal(await app.evaluate(() => captureProbe.length), 1);
        checks.push(
          'Browser-denied microphone permission is handled without a capture stream',
        );
      }
      await tab('Settings');
      await app.getByLabel('Instrument').selectOption('triangle');
      await app.getByText('Ready offline', { exact: true }).waitFor();
      await context.setOffline(true);
      await app.reload();
      await app.getByLabel('Instrument').waitFor();
      assert.equal(await app.getByLabel('Instrument').inputValue(), 'triangle');
      await tab('Reference');
      await app
        .getByRole('button', { name: 'Private test score', exact: true })
        .waitFor();
      const restoredHistory = await app.evaluate(() => {
        const key = Object.keys(localStorage).find((k) => k.endsWith('history/v1'));
        return JSON.parse(localStorage.getItem(key));
      });
      assert.deepEqual(restoredHistory, savedHistory);
      checks.push(
        'Settings, exercise history and IndexedDB score survive offline reload and hash navigation',
      );
      const runtimeTraffic = server.traffic
        .slice(networkStart)
        .filter((request) => request.port === 4211);
      const maintenance = runtimeTraffic.filter(
        (request) => request.path === '/runtime/sw.js' && request.method === 'GET',
      );
      assert.deepEqual(
        runtimeTraffic.filter((request) => !maintenance.includes(request)),
        [],
        'Application resource request escaped its worker cache',
      );
      if (!deployed)
        checks.push(
          'No application resource requests reach the physical runtime HTTP server; fixed host-worker update traffic is recorded separately',
        );
      assert.deepEqual(errors, []);
      results.push({
        name,
        environment: deployed ? 'deployed' : 'local',
        version: browser.version(),
        checks,
        worker,
        frequency,
        executableReceipt,
        maintenance: deployed ? null : maintenance,
        policyObservations,
        errors,
      });
    } catch (error) {
      results.push({
        name,
        checks,
        errors,
        body: app
          ? await app
              .locator('body')
              .innerText()
              .catch(() => null)
          : null,
        audio: app
          ? await app
              .evaluate(() => ({
                buffers: window.audioProbe,
                captureErrors: window.captureErrors,
                visibility: document.visibilityState,
              }))
              .catch(() => null)
          : null,
        failure: error.stack,
      });
      throw error;
    } finally {
      await context.close();
      await browser.close();
    }
  }
} finally {
  await server.close();
  await rm(temporary, { recursive: true, force: true });
  await writeFile(
    new URL(
      '../results/' + (deployed ? 'pitch-training-deployed.json' : 'pitch-training.json'),
      import.meta.url,
    ),
    JSON.stringify(results, null, 2) + '\n',
  );
}
console.log(
  results
    .map((r) => `${r.name}: ${r.checks.length} pitch-training groups passed`)
    .join('\n'),
);
