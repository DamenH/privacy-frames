import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import dgram from 'node:dgram';
import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import { response } from '../src/runtime/response-policy.ts';
import { launch } from './browser-profile.ts';

// Header-only native controls intentionally omit CSP and all application hooks.
// Otherwise CSP could make an ignored Connection-Allowlist appear effective.
const allowlist = response('').headers.get('Connection-Allowlist');
assert(allowlist);
const observations = {
  externalHTTP: [] as string[],
  externalUpgrades: [] as string[],
  externalTCP: [] as number[],
  localHTTP: [] as string[],
  localUpgrades: [] as string[],
  stun: [] as number[],
};
const receiver = http.createServer((request, reply) => {
  observations.externalHTTP.push(request.url || '/');
  reply.setHeader('Access-Control-Allow-Origin', '*');
  reply.setHeader('Connection', 'close');
  reply.end('external response');
});
receiver.on('connection', () => observations.externalTCP.push(Date.now()));
receiver.on('upgrade', (request, socket) => {
  observations.externalUpgrades.push(request.url || '/');
  const accept = createHash('sha1')
    .update(
      String(request.headers['sec-websocket-key']) +
        '258EAFA5-E914-47DA-95CA-C5AB0DC85B11',
    )
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
      accept +
      '\r\n\r\n',
  );
  socket.once('data', () => socket.end(Buffer.from([0x88, 0x00])));
});
const udp = dgram.createSocket('udp4');
udp.on('message', (bytes) => {
  if (bytes.length >= 20 && bytes.readUInt32BE(4) === 0x2112a442)
    observations.stun.push(Date.now());
});
await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
await new Promise<void>((resolve) => udp.bind(0, '127.0.0.1', resolve));
const receiverAddress = receiver.address();
assert(receiverAddress && typeof receiverAddress !== 'string');
const external = 'http://127.0.0.1:' + receiverAddress.port;
const stunPort = udp.address().port;

const probe = `async ({external,marker,stunPort,rtc=false})=>{
  const outcome={};
  const attempt=async(name,url)=>{try{outcome[name]=await (await fetch(url,{cache:'no-store'})).text()}catch(error){outcome[name]=error.name}};
  await attempt('external',external+'/fetch?marker='+marker);
  await attempt('local','/local?marker='+marker);
  await attempt('sameOriginEgress','/same-origin-egress?marker='+marker);
  await attempt('redirect','/redirect?marker='+marker);
  const socket=async(url)=>new Promise(resolve=>{let socket;const timer=setTimeout(()=>{socket?.close();resolve('timeout')},1500);try{socket=new WebSocket(url);socket.onopen=()=>{clearTimeout(timer);socket.close();resolve('open')};socket.onerror=()=>{clearTimeout(timer);resolve('error')}}catch(error){clearTimeout(timer);resolve(error.name)}});
  outcome.externalSocket=await socket(external.replace('http:','ws:')+'/socket?marker='+marker);
  outcome.sameOriginSocket=await socket(location.origin.replace('http:','ws:')+'/socket?marker='+marker);
  if(rtc){try{const peer=new RTCPeerConnection({iceServers:[{urls:'stun:127.0.0.1:'+stunPort}]});try{peer.createDataChannel('probe');await peer.setLocalDescription(await peer.createOffer());await new Promise(resolve=>setTimeout(resolve,1500));outcome.rtc='gathered'}finally{peer.close()}}catch(error){outcome.rtc=error.name+':'+error.message}}
  return outcome;
}`;
const workerSource = `const probe=${probe};self.onmessage=async event=>{self.postMessage(await probe(event.data))};`;
const sharedSource = `const probe=${probe};self.onconnect=event=>{const port=event.ports[0];port.onmessage=async event=>port.postMessage(await probe(event.data));port.start()};`;
const swSource = `const policy=${JSON.stringify(allowlist)};const worker=${JSON.stringify(workerSource)};const shared=${JSON.stringify(sharedSource)};const events=[];
self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{if(event.data?.type==='native-proxy')event.waitUntil(fetch(event.data.url).then(reply=>reply.text()).then(text=>event.ports[0].postMessage(text)))});
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);events.push({url:url.href,destination:event.request.destination});
  if(url.pathname==='/__events'){event.respondWith(new Response(JSON.stringify(events)));return}
  if(url.pathname==='/local'){event.respondWith(new Response('synthetic local resource'));return}
  if(url.pathname==='/redirect'){event.respondWith(new Response('',{status:302,headers:{Location:'/redirect-target'+url.search}}));return}
  if(url.pathname.startsWith('/synthetic/')){const headers={'Content-Type':url.pathname.endsWith('.js')?'text/javascript':'text/html'};if(url.pathname.includes('/policy/'))headers['Connection-Allowlist']=policy;let body='<!doctype html><title>SW-generated native context</title>';if(url.pathname.endsWith('worker.js'))body=worker;else if(url.pathname.endsWith('shared.js')||url.pathname.endsWith('publisher.js'))body=shared;event.respondWith(new Response(body,{headers}));return}
});`;
const server = http.createServer((request, reply) => {
  const url = new URL(request.url || '/', 'http://fixture.invalid');
  observations.localHTTP.push(url.pathname + url.search);
  reply.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/sw.js') {
    reply.setHeader('Content-Type', 'text/javascript');
    reply.end(swSource);
  } else if (url.pathname === '/local') reply.end('network local resource');
  else if (url.pathname === '/redirect') {
    reply.writeHead(302, { Location: '/redirect-target' + url.search });
    reply.end();
  } else if (url.pathname === '/redirect-target') reply.end('redirect followed');
  else if (url.pathname === '/same-origin-egress')
    reply.end('same-origin network reached');
  else {
    if (url.pathname.includes('/policy/'))
      reply.setHeader('Connection-Allowlist', allowlist);
    reply.setHeader(
      'Content-Type',
      url.pathname.endsWith('.js') ? 'text/javascript' : 'text/html',
    );
    reply.end(
      url.pathname.endsWith('worker.js')
        ? workerSource
        : url.pathname.endsWith('shared.js') || url.pathname.endsWith('publisher.js')
          ? sharedSource
          : '<!doctype html><title>Native header control</title>',
    );
  }
});
server.on('upgrade', (request, socket) => {
  observations.localUpgrades.push(request.url || '/');
  const accept = createHash('sha1')
    .update(
      String(request.headers['sec-websocket-key']) +
        '258EAFA5-E914-47DA-95CA-C5AB0DC85B11',
    )
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
      accept +
      '\r\n\r\n',
  );
  socket.once('data', () => socket.end(Buffer.from([0x88, 0x00])));
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address !== 'string');
const origin = 'http://127.0.0.1:' + address.port;
const rows: object[] = [];
const receipt = {
  provenance: {
    capturedAt: new Date().toISOString(),
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    runnerSHA256: createHash('sha256')
      .update(await readFile(new URL(import.meta.url)))
      .digest('hex'),
    policySourceSHA256: createHash('sha256')
      .update(
        await readFile(new URL('../src/runtime/response-policy.ts', import.meta.url)),
      )
      .digest('hex'),
    scope:
      'Header-only native browser controls; actual service-worker-generated document/worker responses. Existing CSP and runtime API blockers are deliberately absent from this fixture. Publisher executor means native SharedWorker execution class, not the full publisher RPC protocol.',
  },
  policy: allowlist,
  rows,
  observations,
};
try {
  for (const engine of [chromium, firefox]) {
    const browser = await launch(
      engine,
      engine === firefox
        ? { firefoxUserPrefs: { 'media.peerconnection.ice.loopback': true } }
        : {},
    );
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      for (const synthetic of [false, true]) {
        if (synthetic) {
          await page.goto(origin);
          await page.evaluate(async () => {
            await navigator.serviceWorker.register('/sw.js');
            await navigator.serviceWorker.ready;
            if (!navigator.serviceWorker.controller)
              await new Promise<void>((resolve) =>
                navigator.serviceWorker.addEventListener(
                  'controllerchange',
                  () => resolve(),
                  { once: true },
                ),
              );
          });
        }
        for (const policy of [false, true]) {
          const prefix =
            '/' +
            (synthetic ? 'synthetic' : 'direct') +
            '/' +
            (policy ? 'policy' : 'control') +
            '/';
          await page.goto(origin + prefix);
          const marker = [
            engine.name(),
            synthetic ? 'synthetic' : 'direct',
            policy ? 'policy' : 'control',
            'document',
          ].join('-');
          const start = {
            http: observations.externalHTTP.length,
            upgrades: observations.externalUpgrades.length,
            tcp: observations.externalTCP.length,
            stun: observations.stun.length,
          };
          const outcome = await page.evaluate(
            ({ source, input }) => (0, eval)(source)(input),
            { source: probe, input: { external, marker, stunPort, rtc: true } },
          );
          const observed = {
            http: observations.externalHTTP.slice(start.http),
            upgrades: observations.externalUpgrades.slice(start.upgrades),
            tcp: observations.externalTCP.length - start.tcp,
            stun: observations.stun.length - start.stun,
          };
          assert(outcome.local.includes('local resource'));
          assert.equal(outcome.sameOriginEgress, 'same-origin network reached');
          assert(
            observations.localUpgrades.some((path) => path.includes(marker)),
            'Same-origin socket collector inactive',
          );
          if (!policy) {
            assert(
              observed.http.some((path) => path.includes(marker)),
              'Unrestricted HTTP control inactive',
            );
            assert(
              observed.upgrades.some((path) => path.includes(marker)),
              'Unrestricted WebSocket control inactive',
            );
            assert(observed.stun > 0, 'Unrestricted STUN UDP control inactive');
          } else if (engine === chromium) {
            assert.equal(outcome.external, 'TypeError');
            assert.deepEqual(observed.http, []);
            assert.deepEqual(observed.upgrades, []);
            assert.equal(observed.tcp, 0);
            assert.equal(observed.stun, 0);
            if (!synthetic) assert.equal(outcome.redirect, 'TypeError');
          }
          rows.push({
            browser: engine.name(),
            version: browser.version(),
            synthetic,
            policy,
            kind: 'document',
            outcome,
            observed,
          });
        }
        // An unrestricted parent isolates each worker's own response policy.
        await page.goto(
          origin + '/' + (synthetic ? 'synthetic' : 'direct') + '/control/',
        );
        for (const kind of ['worker', 'shared', 'publisher']) {
          for (const policy of [false, true]) {
            const marker = [
              engine.name(),
              synthetic ? 'synthetic' : 'direct',
              policy ? 'policy' : 'control',
              kind,
            ].join('-');
            const url =
              origin +
              '/' +
              (synthetic ? 'synthetic' : 'direct') +
              '/' +
              (policy ? 'policy' : 'control') +
              '/' +
              kind +
              '.js';
            const start = {
              http: observations.externalHTTP.length,
              upgrades: observations.externalUpgrades.length,
              tcp: observations.externalTCP.length,
            };
            const outcome = await page.evaluate(
              async ({ kind, url, input }) => {
                const worker =
                  kind === 'worker'
                    ? new Worker(url)
                    : new SharedWorker(url, { name: input.marker });
                const port = kind === 'worker' ? worker : worker.port;
                try {
                  return await new Promise((resolve, reject) => {
                    const timer = setTimeout(
                      () => reject(new Error('Worker probe timed out')),
                      10000,
                    );
                    worker.onerror = (event) => {
                      clearTimeout(timer);
                      reject(new Error(event.message));
                    };
                    port.onmessage = (event) => {
                      clearTimeout(timer);
                      resolve(event.data);
                    };
                    port.start?.();
                    port.postMessage(input);
                  });
                } finally {
                  if (kind === 'worker') worker.terminate();
                  else port.close();
                }
              },
              { kind, url, input: { external, marker, stunPort } },
            );
            const observed = {
              http: observations.externalHTTP.slice(start.http),
              upgrades: observations.externalUpgrades.slice(start.upgrades),
              tcp: observations.externalTCP.length - start.tcp,
            };
            assert(outcome.local.includes('local resource'));
            assert.equal(outcome.sameOriginEgress, 'same-origin network reached');
            assert.equal(outcome.sameOriginSocket, 'open');
            if (!policy) {
              assert(observed.http.some((path) => path.includes(marker)));
              assert(observed.upgrades.some((path) => path.includes(marker)));
            } else if (engine === chromium) {
              assert.equal(outcome.external, 'TypeError');
              assert.deepEqual(observed.http, []);
              assert.deepEqual(observed.upgrades, []);
              assert.equal(observed.tcp, 0);
              if (!synthetic) assert.equal(outcome.redirect, 'TypeError');
            }
            rows.push({
              browser: engine.name(),
              version: browser.version(),
              synthetic,
              policy,
              kind: kind === 'publisher' ? 'publisher-shared-executor' : kind,
              outcome,
              observed,
            });
          }
        }
        if (synthetic) {
          await page.goto(origin + '/synthetic/policy/');
          const marker = engine.name() + '-native-controller-relay';
          const result = await page.evaluate(
            async (url) => {
              const channel = new MessageChannel();
              return await new Promise((resolve) => {
                channel.port1.onmessage = (event) => {
                  channel.port1.close();
                  resolve(event.data);
                };
                navigator.serviceWorker.controller.postMessage(
                  { type: 'native-proxy', url },
                  [channel.port2],
                );
              });
            },
            external + '/relay?marker=' + marker,
          );
          assert.equal(result, 'external response');
          assert(observations.externalHTTP.some((path) => path.includes(marker)));
          const events = await page.evaluate(
            async () => await (await fetch('/__events')).json(),
          );
          for (const kind of ['worker', 'shared', 'publisher'])
            assert(
              events.some((event) =>
                event.url.endsWith('/synthetic/policy/' + kind + '.js'),
              ),
              'Policy worker did not use the synthetic service-worker response',
            );
          rows.push({
            browser: engine.name(),
            kind: 'native-controller-relay-control',
            result,
            events,
          });
        }
      }
      await context.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  await mkdir('results/trusted-runtime', { recursive: true });
  await writeFile(
    process.env.CONNECTION_RESULTS || 'results/trusted-runtime/connection-allowlist.json',
    JSON.stringify(receipt, null, 2) + '\n',
  );
  server.closeAllConnections();
  receiver.closeAllConnections();
  await Promise.all([
    new Promise<void>((resolve) => server.close(() => resolve())),
    new Promise<void>((resolve) => receiver.close(() => resolve())),
    new Promise<void>((resolve) => udp.close(() => resolve())),
  ]);
}
console.log(JSON.stringify(rows, null, 2));
