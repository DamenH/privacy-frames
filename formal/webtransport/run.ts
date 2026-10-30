import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from 'playwright';
import { launch } from '../../test/browser-profile.ts';
import { servers } from '../../test/server.ts';
import { testProvenance } from '../../test/provenance.ts';

interface ReceiverEvent {
  kind: string;
  [key: string]: unknown;
}
function receiverEvent(value: unknown): ReceiverEvent {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('kind' in value) ||
    typeof value.kind !== 'string'
  )
    throw new Error('Invalid receiver event');
  return { ...value, kind: value.kind };
}
function receiverReady(value: ReceiverEvent): Ready {
  if (
    typeof value.port !== 'number' ||
    !Number.isInteger(value.port) ||
    value.port < 1 ||
    value.port > 65535 ||
    typeof value.certificateSHA256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.certificateSHA256)
  )
    throw new Error('Invalid receiver readiness');
  return { ...value, port: value.port, certificateSHA256: value.certificateSHA256 };
}
interface Ready extends ReceiverEvent {
  port: number;
  certificateSHA256: string;
}
const directory = fileURLToPath(new URL('./', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'pf-webtransport-proof-'));
const marker = 'pf-webtransport-independent-control';
async function receiver(port = 0) {
  const python = process.env.PF_WEBTRANSPORT_PYTHON;
  const args = [
    join(directory, 'receiver.py'),
    '--directory',
    temporary,
    '--port',
    String(port),
  ];
  const child = python
    ? spawn(python, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn(
        'uv',
        [
          'run',
          '--python',
          '3.13',
          '--with-requirements',
          join(directory, 'requirements.lock'),
          ...args,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
  const events: ReceiverEvent[] = [],
    errors: string[] = [];
  let buffered = '';
  let resolveReady!: (value: Ready) => void, rejectReady!: (reason: Error) => void;
  const ready = new Promise<Ready>((yes, no) => {
    resolveReady = yes;
    rejectReady = no;
  });
  const timer = setTimeout(
    () => rejectReady(new Error('HTTP/3 receiver startup timed out')),
    60000,
  );
  child.stdout.on('data', (chunk) => {
    buffered += chunk.toString();
    for (let end = buffered.indexOf('\n'); end !== -1; end = buffered.indexOf('\n')) {
      const line = buffered.slice(0, end);
      buffered = buffered.slice(end + 1);
      try {
        const value = receiverEvent(JSON.parse(line));
        events.push(value);
        if (value.kind === 'ready') {
          clearTimeout(timer);
          resolveReady(receiverReady(value));
        }
      } catch {
        rejectReady(new Error('Invalid receiver record: ' + line));
      }
    }
  });
  child.stderr.on('data', (value) => errors.push(value.toString()));
  child.on('error', rejectReady);
  child.on('exit', (code) => {
    clearTimeout(timer);
    rejectReady(new Error('Receiver exited: ' + code + ' ' + errors.join('')));
  });
  let info: Ready;
  try {
    info = await ready;
  } catch (error) {
    child.kill('SIGTERM');
    throw error;
  }
  return {
    info,
    events,
    errors,
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise<void>((done) => child.once('exit', () => done()));
      child.kill('SIGTERM');
      await exited;
    },
  };
}

// The exact same function, URL, certificate pin and payload are used in each
// environment. A constructor error alone cannot establish a working receiver.
interface AttemptResult {
  available: boolean;
  ready: boolean;
  datagram?: string;
  stream?: string;
  error?: string;
}
async function attempt({
  url,
  digest,
  marker,
}: {
  url: string;
  digest: number[];
  marker: string;
}): Promise<AttemptResult> {
  if (typeof WebTransport !== 'function') return { available: false, ready: false };
  let transport: WebTransport | undefined;
  const timeout = <T>(promise: Promise<T>, label: string): Promise<T> =>
    Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(label + ' timed out')), 12000),
      ),
    ]);
  try {
    transport = new WebTransport(url, {
      serverCertificateHashes: [{ algorithm: 'sha-256', value: new Uint8Array(digest) }],
    });
    void transport.closed.catch(() => {});
    await timeout(transport.ready, 'ready');
    const writer = transport.datagrams.writable.getWriter();
    await timeout(writer.write(new TextEncoder().encode(marker)), 'datagram write');
    const data = await timeout(
      transport.datagrams.readable.getReader().read(),
      'datagram read',
    );
    const stream = await timeout(
      transport.createBidirectionalStream(),
      'bidirectional stream',
    );
    const streamWriter = stream.writable.getWriter();
    await streamWriter.write(new TextEncoder().encode(marker + '-stream'));
    await streamWriter.close();
    const response = await timeout(stream.readable.getReader().read(), 'stream read');
    transport.close();
    await timeout(transport.closed, 'close');
    return {
      available: true,
      ready: true,
      datagram: new TextDecoder().decode(data.value),
      stream: new TextDecoder().decode(response.value),
    };
  } catch (error) {
    transport?.close();
    return {
      available: true,
      ready: false,
      error: error instanceof Error ? error.name + ': ' + error.message : String(error),
    };
  }
}

const controlServer = http.createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end('<!doctype html><title>Native WebTransport positive control</title>');
});
await new Promise<void>((done) => controlServer.listen(0, '127.0.0.1', done));
const address = controlServer.address();
if (!address || typeof address === 'string') throw new Error('Control page did not bind');
const evidence = {
  date: new Date().toISOString(),
  scope:
    'Native HTTP/3 datagram and bidirectional-stream positive controls, followed by the identical attempt inside the installed production runtime; independent loopback UDP receiver. Fresh receiver/browser processes separate each phase.',
  provenance: await testProvenance(import.meta.url),
  inputs: Object.fromEntries(
    await Promise.all(
      ['receiver.py', 'requirements.lock'].map(async (name) => [
        name,
        createHash('sha256')
          .update(await readFile(join(directory, name)))
          .digest('hex'),
      ]),
    ),
  ),
  browsers: [] as unknown[],
};
let fixtures: Awaited<ReturnType<typeof servers>> | undefined;
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const positiveReceiver = await receiver();
    const target = {
      url: 'https://127.0.0.1:' + positiveReceiver.info.port + '/wt-independent-marker',
      digest: [...Buffer.from(positiveReceiver.info.certificateSHA256, 'hex')],
      marker,
    };
    let positive: Awaited<ReturnType<typeof attempt>> | undefined;
    let version = '';
    const nativeBrowser = await launch(engine);
    try {
      version = nativeBrowser.version();
      const page = await nativeBrowser.newPage();
      await page.goto('http://127.0.0.1:' + address.port + '/');
      positive = await page.evaluate(attempt, target);
      assert.equal(
        positive.ready,
        true,
        name + ': endpoint positive control failed: ' + JSON.stringify(positive),
      );
      assert.equal(positive.datagram, marker);
      assert.equal(positive.stream, marker + '-stream');
    } finally {
      await nativeBrowser.close();
      await positiveReceiver.close();
    }
    assert(positiveReceiver.events.some((event) => event.kind === 'accepted'));
    assert(
      positiveReceiver.events.some(
        (event) => event.kind === 'application-datagram' && event.data === marker,
      ),
    );
    assert(
      positiveReceiver.events.some(
        (event) =>
          event.kind === 'application-stream' && event.data === marker + '-stream',
      ),
    );
    // Restart the receiver on the SAME UDP endpoint and certificate, after the
    // positive-control browser has exited. Late control packets cannot come from
    // a still-running positive-control browser during the confined measurement.
    const confinedReceiver = await receiver(positiveReceiver.info.port);
    assert.equal(
      confinedReceiver.info.certificateSHA256,
      positiveReceiver.info.certificateSHA256,
    );
    const browser = await launch(engine);
    let isolated: Awaited<ReturnType<typeof attempt>> | undefined;
    try {
      fixtures = await servers({ receiver: false });
      const context = await browser.newContext();
      const manager = await context.newPage();
      await manager.goto('http://127.0.0.1:4210/privacy-frames/');
      await manager.getByText('Ready to install.', { exact: true }).waitFor();
      await manager.locator('#app-url').fill('http://127.0.0.1:4215/');
      await manager.locator('#install button').click();
      await manager.locator('[data-app="adversary"]').waitFor();
      const opened = context.waitForEvent('page');
      await manager.locator('[data-app="adversary"]').click();
      const app = await opened;
      await app.waitForFunction(() =>
        document.querySelector('#mode')?.textContent?.includes('network isolated'),
      );
      isolated = await app.evaluate(attempt, target);
      assert.equal(isolated.ready, false, name + ': confined app reached WebTransport');
      // Give asynchronous network initiation a bounded observation interval.
      await new Promise((done) => setTimeout(done, 1500));
    } finally {
      await browser.close();
      await confinedReceiver.close();
      if (fixtures) {
        await fixtures.close();
        fixtures = undefined;
      }
    }
    const datagrams = confinedReceiver.events.filter((event) => event.kind === 'udp');
    const value = {
      name,
      version,
      receiver: positiveReceiver.info,
      positive,
      isolated,
      positiveEvents: positiveReceiver.events,
      isolatedEvents: confinedReceiver.events,
      confinedUDPDatagrams: datagrams.length,
    };
    evidence.browsers.push(value);
    assert.equal(
      datagrams.length,
      0,
      name + ': confined WebTransport caused UDP traffic',
    );
    console.log(
      name +
        ': native HTTP/3 ready + datagram/stream echo; confined attempt produced 0 receiver UDP packets',
    );
  }
} catch (error) {
  evidence.browsers.push({
    failure: String(error),
    endpointAvailabilityEstablishedOnlyForCompletedControls: true,
  });
  throw error;
} finally {
  if (fixtures) await fixtures.close();
  await new Promise<void>((done) => controlServer.close(() => done()));
  await writeFile(
    resolve(directory, 'results.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  );
  await rm(temporary, { recursive: true, force: true });
}
