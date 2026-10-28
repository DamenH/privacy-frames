import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';
import { servers } from './server.ts';
import { testProvenance } from './provenance.ts';

const host = process.env.HOST_URL || 'http://127.0.0.1:4210/privacy-frames/';
const ownedHost = process.env.HOST_URL ? undefined : await servers({ receiver: false });
const traffic: string[] = [];
const sockets: string[] = [];
const receiver = http.createServer((request, response) => {
  traffic.push(request.url || '/');
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.end('Receiver control');
});
receiver.on('upgrade', (request, socket) => {
  sockets.push(request.url || '/');
  socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
});
await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
const receiverAddress = receiver.address();
if (!receiverAddress || typeof receiverAddress === 'string')
  throw new Error('Missing receiver address');
const outside = 'http://127.0.0.1:' + receiverAddress.port;
const childCode = `fetch(${JSON.stringify(outside + '/child?nonce=')}+Date.now()).then(()=>parent.postMessage({customChild:'escaped'},'*'),()=>parent.postMessage({customChild:'blocked'},'*'));`;
const workerCode = `new Function('url','return fetch(url)')(${JSON.stringify(outside + '/worker?nonce=')}+Date.now()).then(()=>postMessage('escaped'),()=>postMessage('blocked'));`;
const application = `
window.customChecks={constructors:0,connected:0,attribute:0,upgrades:0,denied:0,child:'pending',worker:'pending',fetch:'pending',evalFetch:'pending',functionFetch:'pending',evalSocketDenied:false,functionWorker:'pending',evalChild:'pending'};
const state=window.customChecks;
addEventListener('message',event=>{if(event.data&&event.data.customChild)state.child=event.data.customChild;if(event.data&&event.data.evalChild)state.evalChild=event.data.evalChild});
class Widget extends HTMLElement {
  static get observedAttributes(){return ['data-value']}
  constructor(){super();state.constructors++;const shadow=this.attachShadow({mode:'open'});shadow.innerHTML='<button>Increment</button>';shadow.querySelector('button').onclick=()=>{this.dataset.value=String(Number(this.dataset.value||0)+1)};
    fetch(${JSON.stringify(outside + '/constructor?nonce=')}+Date.now()).then(()=>state.fetch='escaped',()=>state.fetch='blocked');
    eval(${JSON.stringify(`fetch(${JSON.stringify(outside + '/eval?nonce=')}+Date.now()).then(()=>state.evalFetch='escaped',()=>state.evalFetch='blocked')`)});
    new Function('url','return fetch(url)')(${JSON.stringify(outside + '/function?nonce=')}+Date.now()).then(()=>state.functionFetch='escaped',()=>state.functionFetch='blocked');
    try{eval(${JSON.stringify(`new WebSocket(${JSON.stringify(outside.replace('http:', 'ws:') + '/eval-socket')})`)})}catch{state.evalSocketDenied=true}
    try{new WebSocket(${JSON.stringify(outside.replace('http:', 'ws:') + '/socket')})}catch{state.denied++}
    const frame=document.createElement('iframe');frame.srcdoc=${JSON.stringify('<!doctype html><script>' + childCode + '</script>')};shadow.append(frame);
    const evalFrame=eval('document.createElement("iframe")');evalFrame.srcdoc=${JSON.stringify('<!doctype html><script>' + childCode.replaceAll('customChild', 'evalChild') + '</script>')};shadow.append(evalFrame);
    const worker=new Worker('./worker.js');worker.onmessage=event=>{state.worker=event.data;worker.terminate()};
    const functionWorker=new Function('return new Worker("./worker.js")')();functionWorker.onmessage=event=>{state.functionWorker=event.data;functionWorker.terminate()};
  }
  connectedCallback(){state.connected++;this.dataset.value='1'}
  attributeChangedCallback(){state.attribute++}
}
customElements.define('fixture-widget',Widget);
const widget=document.createElement('fixture-widget');document.body.append(widget);
const detached=document.createElement('fixture-upgrade');
customElements.define('fixture-upgrade',class extends HTMLElement{constructor(){super();state.upgrades++}});
customElements.upgrade(detached);
for(const operation of [()=>customElements.define('fixture-frame',class extends HTMLIFrameElement{},{extends:'iframe'}),()=>customElements.define('fixture-options',class extends HTMLElement{},{}),()=>document.createElement('iframe',{is:'fixture-frame'})]){try{operation()}catch{state.denied++}}
window.customReady=true;
`;
const publisher = http.createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Cache-Control', 'no-store');
  const path = new URL(request.url || '/', 'http://publisher.invalid').pathname;
  if (path === '/app.js' || path === '/worker.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(path === '/app.js' ? application : workerCode);
  } else if (path === '/' || path === '/native.html') {
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<!doctype html><title>Custom element fixture</title><link rel="preload" as="script" href="worker.js"><body><script src="app.js"></script></body>',
    );
  } else response.writeHead(404).end('Missing');
});
await new Promise<void>((resolve) => publisher.listen(0, '127.0.0.1', resolve));
const publisherAddress = publisher.address();
if (!publisherAddress || typeof publisherAddress === 'string')
  throw new Error('Missing publisher address');
const source = 'http://127.0.0.1:' + publisherAddress.port + '/';
const evidence = {
  provenance: await testProvenance(import.meta.url),
  browsers: [] as unknown[],
};
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await launch(engine);
    try {
      const context = await browser.newContext();
      const native = await context.newPage();
      const nativeTraffic = traffic.length,
        nativeSockets = sockets.length;
      await native.goto(source + 'native.html');
      await native.waitForFunction(
        () => Reflect.get(window, 'customChecks')?.worker === 'escaped',
      );
      await native.waitForFunction(
        () => Reflect.get(window, 'customChecks')?.child === 'escaped',
      );
      await native.waitForFunction(() => {
        const state = Reflect.get(window, 'customChecks');
        return (
          state?.evalFetch === 'escaped' &&
          state?.functionFetch === 'escaped' &&
          state?.functionWorker === 'escaped' &&
          state?.evalChild === 'escaped'
        );
      });
      assert(
        traffic.length > nativeTraffic,
        'Native custom constructor/worker/child must reach receiver',
      );
      assert(sockets.length > nativeSockets, 'Native WebSocket must reach receiver');
      await native.close();
      const manager = await context.newPage();
      await manager.goto(host);
      await manager.getByText('Ready to install.', { exact: true }).waitFor();
      await manager.locator('#app-url').fill(source);
      await manager.locator('#install button').click();
      await manager.waitForFunction(
        () =>
          /^(Installed |Installation refused:)/.test(
            document.querySelector('#status')?.textContent || '',
          ),
        {},
        { timeout: 120000 },
      );
      assert.match(await manager.locator('#status').innerText(), /^Installed /);
      const start = traffic.length,
        socketStart = sockets.length;
      const appErrors: string[] = [];
      const opened = context.waitForEvent('page').then((app) => {
        app.on('pageerror', (error) => appErrors.push(error.message));
        return app;
      });
      await manager
        .locator('.app-card')
        .filter({
          has: manager.getByRole('heading', {
            name: 'Custom element fixture',
            exact: true,
          }),
        })
        .getByRole('link', { name: 'Open', exact: true })
        .click();
      const app = await opened;
      await app.waitForFunction(() => Reflect.get(window, 'customReady') === true);
      await app
        .waitForFunction(
          () => {
            const state = Reflect.get(window, 'customChecks');
            return (
              state?.child === 'blocked' &&
              state?.worker === 'blocked' &&
              state?.fetch === 'blocked' &&
              state?.evalFetch === 'blocked' &&
              state?.functionFetch === 'blocked' &&
              state?.functionWorker === 'blocked' &&
              state?.evalChild === 'blocked'
            );
          },
          {},
          { timeout: 30000 },
        )
        .catch(async (error: unknown) => {
          console.error(
            name,
            'custom lifecycle state',
            await app.evaluate(() => JSON.stringify(Reflect.get(window, 'customChecks'))),
          );
          console.error(name, 'custom lifecycle errors', appErrors);
          console.error(
            name,
            'custom element markup',
            await app.locator('body').innerHTML(),
          );
          console.error(
            name,
            'unexpected traffic',
            traffic.slice(start),
            sockets.slice(socketStart),
          );
          throw error;
        });
      await app.locator('fixture-widget button').click();
      const checks = await app.evaluate(() => Reflect.get(window, 'customChecks'));
      assert.equal(checks.constructors, 1);
      assert.equal(checks.connected, 1);
      assert.equal(checks.upgrades, 1);
      assert(checks.attribute >= 2);
      assert.equal(checks.denied, 4);
      assert.equal(checks.evalSocketDenied, true);
      assert.equal(await app.locator('fixture-widget').getAttribute('data-value'), '2');
      await app.waitForTimeout(250);
      assert.deepEqual(traffic.slice(start), []);
      assert.deepEqual(sockets.slice(socketStart), []);
      evidence.browsers.push({
        name,
        version: browser.version(),
        checks,
        nativeRequests: traffic.slice(nativeTraffic, start),
        nativeSockets: sockets.slice(nativeSockets, socketStart),
      });
      await context.close();
      console.log(
        name,
        'autonomous custom elements and confined lifecycle contexts passed',
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  await ownedHost?.close();
  publisher.closeAllConnections();
  receiver.closeAllConnections();
  await Promise.all([
    new Promise<void>((resolve) => publisher.close(() => resolve())),
    new Promise<void>((resolve) => receiver.close(() => resolve())),
  ]);
  await mkdir('results/contexts', { recursive: true });
  await writeFile(
    'results/contexts/custom-elements.json',
    JSON.stringify(evidence, null, 2) + '\n',
  );
}
