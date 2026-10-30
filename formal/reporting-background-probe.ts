import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'pf-reporting-background-'));
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    join(temporary, 'key.pem'),
    '-out',
    join(temporary, 'cert.pem'),
    '-days',
    '1',
    '-subj',
    '/CN=localhost',
    '-addext',
    'subjectAltName=IP:127.0.0.1,DNS:localhost',
  ],
  { stdio: 'ignore' },
);
const cert = await readFile(join(temporary, 'cert.pem'));
const key = await readFile(join(temporary, 'key.pem'));
const pin = createHash('sha256')
  .update(new X509Certificate(cert).publicKey.export({ type: 'spki', format: 'der' }))
  .digest('base64');
const receipt = {
  testedAt: new Date().toISOString(),
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  runnerSHA256: createHash('sha256')
    .update(await readFile(fileURLToPath(import.meta.url)))
    .digest('hex'),
  installedLockSHA256: createHash('sha256')
    .update(await readFile(join(root, 'package-lock.json')))
    .digest('hex'),
  status:
    'UNCALIBRATED modern Reporting API/NEL uploader; diagnostic only, no default CI requirement',
  scope:
    'Native reporting uploader diagnostic only. Restoring background networking does not remove other Playwright defaults. Temporary TLS uses SPKI certificate-error exception, not an installed trust anchor. Legacy CSP receiver is a separate active control. A queued report without observed HTTP upload is unverified, not contained.',
  rows: [],
};
try {
  for (const [transport, restore] of [
    ['http', false],
    ['http', true],
    ['https', true],
  ]) {
    let origin;
    const traffic = [],
      connections = [],
      tlsErrors = [];
    const handler = async (request, reply) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      traffic.push({
        url: request.url,
        method: request.method,
        body,
        type: request.headers['content-type'],
      });
      reply.setHeader('Cache-Control', 'no-store');
      if (request.url.startsWith('/report')) {
        reply.writeHead(204);
        reply.end();
        return;
      }
      if (request.url === '/legacy')
        reply.setHeader(
          'Content-Security-Policy',
          "img-src 'none'; report-uri /report?kind=legacy",
        );
      if (request.url === '/modern') {
        reply.setHeader('Content-Security-Policy', "img-src 'none'; report-to default");
        reply.setHeader(
          'Reporting-Endpoints',
          'default="' + origin + '/report?kind=modern"',
        );
      }
      if (request.url === '/seed') {
        reply.setHeader(
          'Report-To',
          JSON.stringify({
            group: 'nel',
            max_age: 90,
            endpoints: [{ url: origin + '/report?kind=nel' }],
          }),
        );
        reply.setHeader(
          'NEL',
          JSON.stringify({
            report_to: 'nel',
            max_age: 90,
            success_fraction: 1.0,
            failure_fraction: 1.0,
          }),
        );
      }
      reply.setHeader('Content-Type', 'text/html');
      reply.end('<!doctype html><title>Background reporting control</title>');
    };
    const server =
      transport === 'https'
        ? https.createServer({ key, cert }, handler)
        : http.createServer(handler);
    server.on('connection', () => connections.push(Date.now()));
    server.on('tlsClientError', (error) =>
      tlsErrors.push({ code: error.code, message: error.message }),
    );
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = transport + '://127.0.0.1:' + server.address().port;
    let browser;
    try {
      browser = await chromium.launch({
        ...(restore ? { ignoreDefaultArgs: ['--disable-background-networking'] } : {}),
        args: [
          '--enable-automation',
          '--short-reporting-delay',
          ...(transport === 'https'
            ? ['--ignore-certificate-errors-spki-list=' + pin]
            : []),
        ],
      });
      const page = await browser.newPage();
      const session = await page.context().newCDPSession(page);
      const { arguments: actualArguments } = await session.send(
        'Browser.getBrowserCommandLine',
      );
      assert.equal(actualArguments.includes('--disable-background-networking'), !restore);
      await session.send('Network.enableReportingApi', { enable: true });
      const added = [],
        updated = [],
        endpoints = [];
      session.on('Network.reportingApiReportAdded', (event) => added.push(event));
      session.on('Network.reportingApiReportUpdated', (event) => updated.push(event));
      session.on('Network.reportingApiEndpointsChanged', (event) =>
        endpoints.push(event),
      );
      const row = {
        transport,
        restore,
        origin,
        version: browser.version(),
        actualArguments,
        headers: [],
        traffic,
        connections,
        tlsErrors,
        added,
        updated,
        endpoints,
      };
      receipt.rows.push(row);
      for (const profile of ['legacy', 'modern', 'seed']) {
        const navigation = await page.goto(origin + '/' + profile);
        row.headers.push({ profile, headers: await navigation.allHeaders() });
        if (profile === 'seed')
          await page.evaluate(() =>
            fetch('/nel-native-positive?private-marker=nel-control'),
          );
        else
          await page.evaluate((profile) => {
            const image = new Image();
            image.src = '/blocked-image?private-marker=' + profile;
            document.body.append(image);
          }, profile);
        if (profile === 'modern')
          await session.send('Page.generateTestReport', {
            message: 'uploader-control-only',
            group: 'default',
          });
        await page.waitForTimeout(3000);
      }
      assert(
        traffic.some(
          (item) =>
            item.url.startsWith('/report?kind=legacy') &&
            item.body.includes('private-marker=legacy'),
        ),
        'Legacy CSP receiver control inactive',
      );
      row.modernDelivered = traffic.some((item) =>
        item.url.startsWith('/report?kind=modern'),
      );
      row.nelDelivered = traffic.some((item) => item.url.startsWith('/report?kind=nel'));
      console.log(
        JSON.stringify({
          transport,
          restore,
          backgroundDisabled: actualArguments.includes('--disable-background-networking'),
          modernDelivered: row.modernDelivered,
          nelDelivered: row.nelDelivered,
          added: added.length,
          endpoints: endpoints.length,
          tlsErrors,
        }),
      );
    } finally {
      await browser?.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  }
} finally {
  await writeFile(
    join(root, 'formal/evidence/reporting-background-networking.json'),
    JSON.stringify(receipt, null, 2) + '\n',
  );
  await rm(temporary, { recursive: true, force: true });
}
