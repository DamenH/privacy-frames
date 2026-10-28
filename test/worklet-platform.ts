import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';
import { testProvenance } from './provenance.ts';

const capabilities = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'WebTransport',
  'RTCPeerConnection',
  'Worker',
  'SharedWorker',
  'Worklet',
  'MessageChannel',
  'MessagePort',
  'BroadcastChannel',
  'navigator',
  'indexedDB',
  'caches',
  'URL',
  'DOMException',
  'EventTarget',
  'crypto',
  'performance',
  'console',
  'setTimeout',
  'Function',
  'eval',
  'WebAssembly',
  'SharedArrayBuffer',
];
const sw = `const events=[];
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(!url.pathname.startsWith('/audio/')&&!url.pathname.startsWith('/paint/'))return;events.push({url:event.request.url,destination:event.request.destination,clientId:event.clientId,resultingClientId:event.resultingClientId,mode:event.request.mode,credentials:event.request.credentials,referrer:event.request.referrer});event.respondWith(fetch(event.request));});
self.addEventListener('message',event=>{if(event.data==='logs')event.ports[0].postMessage({ownerClientId:event.source.id,events});});`;
const audioEntry = `import './dependency.js';
registerProcessor('platform-probe',class extends AudioWorkletProcessor{
 constructor(options){super();this.port.postMessage({type:'features',prepared:globalThis.workletPrepared===true,dependencyPrepared:globalThis.dependencyPrepared===true,capabilities:Object.fromEntries(${JSON.stringify(capabilities)}.map(name=>[name,typeof globalThis[name]])),globals:Object.getOwnPropertyNames(globalThis).sort(),options:options.processorOptions});import('./dynamic-dependency.js').then(()=>this.port.postMessage({type:'dynamic',outcome:'loaded',marker:globalThis.dynamicLoaded===true})).catch(error=>this.port.postMessage({type:'dynamic',outcome:'rejected',name:error.name,message:error.message}));}
 process(inputs,outputs){for(const output of outputs)for(const channel of output)channel.fill(0.125);return false;}
});`;
const paintEntry = `import './dependency.js';
registerPaint('platform-probe',class{
 paint(context,size){const values=[globalThis.workletPrepared===true,globalThis.dependencyPrepared===true,...${JSON.stringify(capabilities)}.map(name=>typeof globalThis[name]!=='undefined')];for(let index=0;index<values.length;index++){context.fillStyle=values[index]?'#00ff00':'#000000';context.fillRect(index*8,0,8,8);}}
});`;
const server = http.createServer((request, response) => {
  const path = (request.url || '/').split('?')[0];
  let body: string,
    type = 'text/javascript';
  if (path === '/probe-sw.js') body = sw;
  else if (path === '/audio/bootstrap.js' || path === '/paint/bootstrap.js')
    body = "import './prelude.js';import './entry.js';";
  else if (path.endsWith('/prelude.js')) body = 'globalThis.workletPrepared=true;';
  else if (path.endsWith('/dependency.js'))
    body = 'globalThis.dependencyPrepared=globalThis.workletPrepared===true;';
  else if (path === '/audio/dynamic-dependency.js')
    body = 'globalThis.dynamicLoaded=true;';
  else if (path === '/audio/entry.js') body = audioEntry;
  else if (path === '/paint/entry.js') body = paintEntry;
  else {
    type = 'text/html';
    body = '<!doctype html><title>Worklet platform</title>';
  }
  response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  response.end(body);
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Worklet server missing');
const origin = `http://127.0.0.1:${address.port}`;
const evidence = {
  provenance: await testProvenance(import.meta.url),
  scope:
    'Benign unrestricted native Worklet platform controls and browser FetchEvent metadata; no production adapter enabled',
  capabilities,
  browsers: [] as {
    name: string;
    version: string;
    audio: unknown;
    paint: unknown;
    requests: unknown;
  }[],
};
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    try {
      const page = await browser.newPage({
        viewport: { width: 800, height: 200 },
        deviceScaleFactor: 1,
      });
      await page.goto(origin + '/probe/');
      await page.evaluate(async () => {
        await navigator.serviceWorker.register('/probe-sw.js', { scope: '/' });
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller)
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error('Platform controller was not claimed')),
              5000,
            );
            navigator.serviceWorker.addEventListener(
              'controllerchange',
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
          });
      });
      const audio = await page.evaluate(async () => {
        if (typeof OfflineAudioContext !== 'function')
          return { available: false, reason: 'OfflineAudioContext absent' };
        const context = new OfflineAudioContext(1, 256, 44100);
        if (!context.audioWorklet || typeof AudioWorkletNode !== 'function')
          return { available: false, reason: 'AudioWorklet API absent' };
        await context.audioWorklet.addModule('/audio/bootstrap.js');
        const node = new AudioWorkletNode(context, 'platform-probe', {
          processorOptions: { message: 'native structured data' },
        });
        const messages: Record<string, unknown>[] = [];
        const completed = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Native audio port timeout')),
            5000,
          );
          node.port.onmessage = (event) => {
            messages.push(event.data);
            if (
              messages.some((item) => item.type === 'features') &&
              messages.some((item) => item.type === 'dynamic')
            ) {
              clearTimeout(timer);
              resolve();
            }
          };
        });
        node.connect(context.destination);
        const rendered = await context.startRendering();
        await completed;
        node.port.close();
        return { available: true, sample: rendered.getChannelData(0)[0], messages };
      });
      if (audio.available) {
        assert.equal(audio.sample, 0.125);
        const features = audio.messages!.find((item) => item.type === 'features')!;
        assert.equal(features.prepared, true);
        assert.equal(features.dependencyPrepared, true);
      }
      const paintAvailable = await page.evaluate(() => 'paintWorklet' in CSS);
      let paint: unknown = { available: false, reason: 'CSS.paintWorklet absent' };
      if (paintAvailable) {
        await page.evaluate(async (count) => {
          await Reflect.get(CSS, 'paintWorklet').addModule('/paint/bootstrap.js');
          const target = document.createElement('div');
          target.id = 'paint-probe';
          target.style.cssText = `width:${count * 8}px;height:8px;background-image:paint(platform-probe);`;
          document.body.appendChild(target);
        }, capabilities.length + 2);
        const screenshot = await page.locator('#paint-probe').screenshot();
        const values = await page.evaluate(
          async (bytes) => {
            const image = await createImageBitmap(
              new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
            );
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext('2d')!;
            context.drawImage(image, 0, 0);
            return Array.from({ length: image.width / 8 }, (_, index) => {
              const pixel = context.getImageData(index * 8 + 4, 4, 1, 1).data;
              return pixel[1] > 200 && pixel[0] < 20;
            });
          },
          [...screenshot],
        );
        assert.equal(values[0], true, 'Native paint did not run after prelude');
        assert.equal(values[1], true, 'Native paint dependency ran before prelude');
        paint = {
          available: true,
          prepared: values[0],
          dependencyPrepared: values[1],
          capabilities: Object.fromEntries(
            capabilities.map((key, index) => [key, values[index + 2]]),
          ),
        };
      }
      const requests = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const channel = new MessageChannel();
            channel.port1.onmessage = (event) => resolve(event.data);
            navigator.serviceWorker.controller!.postMessage('logs', [channel.port2]);
          }),
      );
      evidence.browsers.push({
        name,
        version: browser.version(),
        audio,
        paint,
        requests,
      });
      console.log(
        `${name}: AudioWorklet ${audio.available ? 'native processor/port/render passed' : 'unavailable'}; paint ${paintAvailable ? 'native paint passed' : 'unavailable'}`,
      );
    } finally {
      await browser.close();
    }
  }
  await mkdir('results/contexts', { recursive: true });
  await writeFile(
    'results/contexts/worklet-platform.json',
    JSON.stringify(evidence, null, 2) + '\n',
  );
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
