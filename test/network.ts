import { launch } from './browser-profile.ts';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import http from 'node:http';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, firefox } from 'playwright';
import { servers } from './server.ts';
import { testProvenance } from './provenance.ts';
// Trace only our fresh browser and children; no root privileges or system-wide
// capture. Retain only synthetic-marker evidence, deleting raw traces afterward.
const directory = await mkdtemp(join(tmpdir(), 'pf-network-')),
  wrapper = join(directory, 'browser');
const name = process.env.NETWORK_BROWSER || 'chromium',
  engine = { chromium, firefox }[name];
if (!engine) throw new Error('Unknown network test browser');
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
await writeFile(
  wrapper,
  '#!/bin/sh\nexec strace -ff -e trace=connect,sendto,sendmsg,sendmmsg -xx -s 4096 -o "$PF_TRACE_PREFIX" ' +
    quote(engine.executablePath()) +
    ' "$@"\n',
  { mode: 0o700 },
);
const server = await servers({ receiver: false }),
  udp = dgram.createSocket('udp4'),
  datagrams = [];
const receiverRequests: string[] = [];
const receiverConnections: number[] = [];
const receiver = http.createServer((request, response) => {
  receiverRequests.push(request.url || '/');
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.end('Independent network receiver');
});
receiver.on('connection', () => receiverConnections.push(Date.now()));
receiver.on('upgrade', (request, socket) => {
  receiverRequests.push(request.url || '/');
  socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
});
await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
const receiverAddress = receiver.address();
if (!receiverAddress || typeof receiverAddress === 'string')
  throw new Error('Independent receiver did not bind');
const receiverURL = 'http://127.0.0.1:' + receiverAddress.port;
udp.on('message', (bytes, remote) =>
  datagrams.push({
    bytes: bytes.length,
    stun: bytes.length >= 20 && bytes.readUInt32BE(4) === 0x2112a442,
    remote: remote.address,
  }),
);
await new Promise((resolve) => udp.bind(4220, '127.0.0.1', resolve));
const results = {
  provenance: await testProvenance(import.meta.url),
  date: new Date().toISOString(),
  checks: [],
  controls: {},
  isolated: {},
};
let browser;
const token = Date.now().toString(36),
  privateDomain = 'pfrt-private-' + token + '.invalid',
  controlDomain = 'pfrt-control-' + token + '.invalid';
try {
  browser = await launch(engine, {
    executablePath: wrapper,
    env: { ...process.env, PF_TRACE_PREFIX: join(directory, 'trace') },
    ...(name === 'firefox'
      ? { firefoxUserPrefs: { 'media.peerconnection.ice.loopback': true } }
      : {}),
  });
  results.browser = name;
  results.version = browser.version();
  const context = await browser.newContext(),
    manager = await context.newPage();
  results.profile = {
    nativeExecutable: engine.executablePath().split('/').slice(-2).join('/'),
    loopbackRTCEnabledForControl: name === 'firefox',
  };
  await manager.goto('http://127.0.0.1:4210/privacy-frames/');
  await manager.getByText('Ready to install.', { exact: true }).waitFor();
  await manager.locator('#app-url').fill('http://127.0.0.1:4215/');
  await manager.locator('#install button').click();
  await manager.locator('[data-app="adversary"]').waitFor();
  const opened = context.waitForEvent('page');
  await manager.locator('[data-app="adversary"]').click();
  const app = await opened;
  await app.waitForFunction(() =>
    document.querySelector('#mode')?.textContent.includes('network isolated'),
  );
  const trafficStart = server.traffic.length,
    connectionsStart = receiverConnections.length,
    requestsStart = receiverRequests.length;
  results.isolated.operations = await app.evaluate(
    async ({ domain, receiver }) => {
      const outcomes = [];
      const attempt = async (name, fn) => {
        try {
          await fn();
          outcomes.push({ name, refused: false });
        } catch (e) {
          outcomes.push({ name, refused: true, error: e.name });
        }
      };
      const target = 'http://' + domain + '/private-marker';
      const routeURL = (route) =>
        'http://' +
        domain.replace('pfrt-private-', 'pfrt-private-' + route + '-') +
        '/private-marker';
      await attempt('fetch', () => fetch(routeURL('fetch')));
      await attempt('Cache.add', async () => {
        const cache = await caches.open('disclosure');
        await cache.add(routeURL('cache'));
      });
      const image = new Image();
      image.src = routeURL('image');
      document.body.append(image);
      const style = document.createElement('style');
      style.textContent = 'body{background-image:url("' + routeURL('css') + '")}';
      document.head.append(style);
      for (const rel of [
        'preconnect',
        'dns-prefetch',
        'prefetch',
        'prerender',
        'modulepreload',
      ])
        await attempt(rel, () => {
          const link = document.createElement('link');
          link.rel = rel;
          link.href = target;
          document.head.append(link);
        });
      await attempt('speculationrules', () => {
        const script = document.createElement('script');
        script.type = 'speculationrules';
        script.textContent = JSON.stringify({
          prefetch: [{ source: 'list', urls: [target] }],
        });
        document.head.append(script);
      });
      await attempt(
        'WebSocket',
        () => new WebSocket(receiver.replace(/^http/, 'ws') + '/private-marker'),
      );
      await attempt(
        'WebTransport',
        () => new WebTransport('https://' + domain + '/private-marker'),
      );
      await attempt('WebRTC', async () => {
        const peer = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:127.0.0.1:4220' }],
        });
        peer.createDataChannel('private-marker');
        await peer.setLocalDescription(await peer.createOffer());
      });
      await attempt('navigation preload', () =>
        navigator.serviceWorker.ready.then((registration) =>
          registration.navigationPreload.enable(),
        ),
      );
      for (const kind of ['classic', 'module', 'nested']) {
        const address = routeURL('worker-' + kind);
        const source = `
        (async () => {
          const outcomes = [];
          async function attempt(name, operation) {
            try { await operation(); outcomes.push({name, refused:false}); }
            catch (error) { outcomes.push({name, refused:true,error:error.name}); }
          }
          await attempt('fetch', () => fetch(${JSON.stringify(address)}));
          await attempt('dynamic import', () => import(${JSON.stringify(address + '.js')}));
          await attempt('cache download', async () => {
            const cache = await caches.open('network-worker');
            await cache.add(${JSON.stringify(address)});
          });
          await attempt('WebSocket', () => new WebSocket(${JSON.stringify(receiver.replace(/^http/, 'ws') + '/private-marker')}));
          postMessage(outcomes);
        })();
      `;
        const body =
          kind === 'nested'
            ? `const child=new Worker(URL.createObjectURL(new Blob([${JSON.stringify(source)}],{type:'text/javascript'})));child.onmessage=event=>{postMessage(event.data);child.terminate();};child.onerror=()=>postMessage([{name:'nested startup',refused:false}]);`
            : source;
        const blob = URL.createObjectURL(new Blob([body], { type: 'text/javascript' }));
        const worker = new Worker(blob, {
          type: kind === 'module' ? 'module' : 'classic',
        });
        URL.revokeObjectURL(blob);
        try {
          const values = await new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error('Worker probe timed out')),
              15000,
            );
            worker.onmessage = (event) => {
              clearTimeout(timer);
              resolve(event.data);
            };
            worker.onerror = (event) => {
              clearTimeout(timer);
              reject(new Error('Worker probe failed: ' + event.message));
            };
          });
          for (const value of values)
            outcomes.push({ ...value, name: kind + ' worker ' + value.name });
        } finally {
          worker.terminate();
        }
      }
      return outcomes;
    },
    { domain: privateDomain, receiver: receiverURL },
  );
  await app.waitForTimeout(700);
  assert(results.isolated.operations.every((x) => x.refused));
  assert.deepEqual(
    server.traffic.slice(trafficStart).filter((x) => x.path.includes('private-marker')),
    [],
  );
  assert.deepEqual(receiverRequests.slice(requestsStart), []);
  assert.deepEqual(receiverConnections.slice(connectionsStart), []);
  assert.deepEqual(datagrams, []);
  results.isolated.udpDatagrams = 0;
  results.isolated.receiverTCPConnections = 0;
  results.checks.push(
    'Runtime network, cache fetch, speculative links/rules, sockets, RTC and navigation preload refused with zero receiver TCP or STUN UDP traffic',
  );
  await app.close();
  const control = await context.newPage();
  await control.goto(receiverURL);
  const beforeControl = receiverRequests.length;
  await control.evaluate(
    async ({ domain, receiver }) => {
      await fetch(receiver + '/control-marker');
      await fetch('http://' + domain + '/control-marker').catch(() => {});
      const source = `
      (async () => {
        await fetch(${JSON.stringify(receiver + '/control-marker-worker')});
        const fetchAttempt = fetch(${JSON.stringify('http://' + domain.replace('pfrt-control-', 'pfrt-control-worker-') + '/control-marker-worker')}).catch(() => {});
        const importAttempt = import(${JSON.stringify('http://' + domain.replace('pfrt-control-', 'pfrt-control-module-') + '/control-marker-module.js')}).catch(() => {});
        await Promise.race([
          Promise.all([fetchAttempt, importAttempt]),
          new Promise(resolve => setTimeout(resolve, 2000)),
        ]);
        postMessage('worker-control-complete');
      })();
    `;
      const blob = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      const worker = new Worker(blob);
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Worker control timed out')),
            15000,
          );
          worker.onmessage = () => {
            clearTimeout(timer);
            resolve();
          };
          worker.onerror = (event) => {
            clearTimeout(timer);
            reject(new Error(event.message));
          };
        });
      } finally {
        worker.terminate();
        URL.revokeObjectURL(blob);
      }
      const link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = 'http://' + domain;
      document.head.append(link);
      const peer = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:127.0.0.1:4220' }],
      });
      window.controlPeer = peer;
      peer.createDataChannel('control');
      await peer.setLocalDescription(await peer.createOffer());
    },
    { domain: controlDomain, receiver: receiverURL },
  );
  const deadline = Date.now() + 7000;
  while (!datagrams.length && Date.now() < deadline) await control.waitForTimeout(100);
  assert(
    receiverRequests.slice(beforeControl).includes('/control-marker'),
    'HTTP control inactive',
  );
  assert(
    receiverRequests.slice(beforeControl).includes('/control-marker-worker'),
    'Worker HTTP control inactive',
  );
  assert(
    datagrams.some((packet) => packet.stun),
    'STUN UDP receiver control inactive',
  );
  results.controls.httpRequests = receiverRequests
    .slice(beforeControl)
    .filter((path) => path === '/control-marker').length;
  results.controls.workerHTTPRequests = receiverRequests
    .slice(beforeControl)
    .filter((path) => path === '/control-marker-worker').length;
  results.controls.udpDatagrams = datagrams.length;
  results.controls.stunDatagrams = datagrams.filter((x) => x.stun).length;
  await control.evaluate(() => controlPeer.close());
  await browser.close();
  browser = null;
  const traces = (await readdir(directory)).filter((name) => name.startsWith('trace.'));
  const queryRecords = [];
  for (const file of traces) {
    const text = await readFile(join(directory, file), 'utf8');
    for (const line of text.split('\n')) {
      if (!/^send(?:to|msg|mmsg)\(/.test(line)) continue;
      const readable = line.replace(/\\x([a-f0-9]{2})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16)),
      );
      // The .invalid label is DNS-encoded, so match the unique first label. This
      // excludes protocol/CDP strings and records actual resolver-bound send calls.
      for (const match of readable.matchAll(
        /(pfrt-(?:private|control)-[a-z0-9-]+)\x07invalid/g,
      ))
        if (
          match[1].endsWith(token) &&
          readable.charCodeAt(match.index - 1) === match[1].length
        )
          queryRecords.push({
            phase: match[1].startsWith('pfrt-private-') ? 'private' : 'control',
            label: match[1],
            syscall: line.match(/^\w+/)[0],
            sent: Number(line.match(/= (\d+)$/)?.[1] || 0),
          });
    }
  }
  results.observation = {
    method:
      'strace of fresh browser/children network send syscalls; independent HTTP/TCP and STUN UDP receivers',
    traceProcesses: traces.length,
    queryRecords,
  };
  assert(
    queryRecords.some((record) => record.phase === 'control' && record.sent > 0),
    'DNS syscall observer control inactive',
  );
  for (const route of ['worker', 'module'])
    assert(
      queryRecords.some(
        (record) =>
          record.label === 'pfrt-control-' + route + '-' + token && record.sent > 0,
      ),
      route + ' DNS syscall observer control inactive',
    );
  assert(
    !queryRecords.some((record) => record.phase === 'private'),
    'Private DNS query escaped',
  );
  results.controls.dnsSendCalls = queryRecords.filter(
    (record) => record.phase === 'control',
  ).length;
  results.isolated.dnsSendCalls = 0;
  results.checks.push(
    'Independent syscall tracing observes real DNS-query sends for the unrestricted control and none for the private marker',
  );
  results.checks.push(
    'HTTP and native STUN UDP controls confirm active collectors with actual browser RTC support',
  );
} catch (error) {
  results.failure = error.stack;
  throw error;
} finally {
  await browser?.close();
  await server.close();
  receiver.closeAllConnections();
  await new Promise<void>((resolve) => receiver.close(() => resolve()));
  udp.close();
  await rm(directory, { recursive: true, force: true });
  await writeFile(
    new URL(
      '../results/' + (name === 'chromium' ? 'network.json' : 'network-firefox.json'),
      import.meta.url,
    ),
    JSON.stringify(results, null, 2) + '\n',
  );
}
console.log(
  `${name} ${results.version}: ${results.checks.length} independent network groups passed`,
);
