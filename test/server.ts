import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repository = fileURLToPath(new URL('../', import.meta.url));
const publisher = path.join(repository, 'dist-examples');
const mediaTypes: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
};

interface RequestObservation {
  port: number;
  path: string;
  method: string;
  origin?: string;
}

export interface UpgradeObservation {
  port: number;
  path: string;
  origin?: string;
  time: number;
}

/** Static files only, with the same separate manager/runtime roles as deployment. */
export async function servers(options: { receiver?: boolean } = {}) {
  const traffic: RequestObservation[] = [];
  const connections: Array<{ port: number; time: number }> = [];
  const upgrades: UpgradeObservation[] = [];
  const listeners: http.Server[] = [];
  const publisherApps: Record<number, string> = {
    4212: 'notes',
    4213: 'image',
    4214: 'notes',
    4215: 'adversary',
    4217: 'playground',
    4218: 'ordinary',
  };

  for (const port of [4210, 4211, 4212, 4213, 4214, 4215, 4366, 4217, 4218, 4219]) {
    if (port === 4366 && options.receiver === false) continue;
    const server = http.createServer(async (request, response) => {
      const url = new URL(request.url ?? '/', 'http://local');
      traffic.push({
        port,
        path: request.url ?? '/',
        method: request.method ?? 'GET',
        origin: request.headers.origin,
      });
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Cache-Control', 'no-store');
      if (port === 4366) {
        if (url.pathname === '/script') {
          response.setHeader('Content-Type', 'text/javascript');
          response.end('globalThis.__boundaryExternalScriptExecuted = true;');
          return;
        }
        response.end('diagnostic receiver');
        return;
      }

      try {
        let relative = decodeURIComponent(url.pathname);
        const trusted = port === 4210 || port === 4211 || port === 4219;
        const prefix =
          port === 4211
            ? '/runtime'
            : port === 4219
              ? '/installation'
              : '/privacy-frames';
        if (trusted) {
          if (relative === prefix) {
            response.writeHead(301, { Location: `${prefix}/` });
            response.end();
            return;
          }
          if (!relative.startsWith(`${prefix}/`)) throw new Error('Outside host scope');
          relative = relative.slice(prefix.length);
        }

        if (trusted && relative === '/config.json') {
          const config = JSON.parse(
            await readFile(path.join(repository, 'dist-manager/config.json'), 'utf8'),
          );
          config.runtimeURL = 'http://127.0.0.1:4211/runtime/';
          config.managerURL = 'http://127.0.0.1:4210/privacy-frames/';
          config.installationURL = 'http://127.0.0.1:4219/installation/';
          config.managerOrigins = ['http://127.0.0.1:4210'];
          config.examples = Object.entries(publisherApps).map(([port, name]) => ({
            name,
            url: 'http://127.0.0.1:' + port + '/',
            resourceListURL: 'http://127.0.0.1:' + port + '/resource-list.uris',
          }));
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify(config));
          return;
        }

        if (!trusted && relative === '/resource-list.uris') {
          const app = publisherApps[port];
          if (!app) throw new Error('Unknown publisher');
          const list = await readFile(
            path.join(publisher, 'resource-lists', app + '.uris'),
            'utf8',
          );
          const original = 'https://privacy-frames.github.io/apps/' + app + '/';
          const local = 'http://127.0.0.1:' + port + '/';
          response.setHeader('Content-Type', 'text/uri-list');
          response.end(list.split(original).join(local));
          return;
        }

        if (port === 4212 && relative === '/broken/') {
          response.setHeader('Content-Type', 'text/html');
          response.end(
            '<!doctype html><title>Broken</title><script src="missing.js"></script>',
          );
          return;
        }
        // Independent fixture: admit a static JSON resource before testing the
        // publisher worker's generated override of that same resource.
        if (port === 4218 && relative === '/phase.json') {
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ phase: 'captured-static', authority: {} }));
          return;
        }
        if (port === 4218 && relative === '/review/sw.js') {
          response.setHeader('Content-Type', 'text/javascript');
          response.end(
            "throw new Error('Unreferenced publisher code must not execute');",
          );
          return;
        }
        if (port === 4218 && relative === '/review/') {
          response.setHeader('Content-Type', 'text/html');
          response.end(
            '<!doctype html><title>Review</title><script id="data" type="application/json">{"value":42}</script><script type="application/ld+json">window.__dataExecuted=true</script><p>Data document</p>',
          );
          return;
        }
        if (port === 4218 && relative.startsWith('/reject/')) {
          if (relative === '/reject/sw.js') {
            response.setHeader('Content-Type', 'text/javascript');
            response.end(
              "self.addEventListener('install',event=>event.waitUntil(Promise.reject(new Error('Installation deliberately rejected'))));",
            );
            return;
          }
          relative = relative.slice('/reject'.length);
        }

        if (relative.endsWith('/')) relative += 'index.html';
        const base = trusted
          ? path.join(
              repository,
              port === 4211
                ? 'dist-runtime'
                : port === 4219
                  ? 'dist-installation'
                  : 'dist-manager',
            )
          : path.join(publisher, publisherApps[port]);
        const filename = path.resolve(base, `.${relative}`);
        if (!filename.startsWith(base + path.sep)) throw new Error('Invalid path');
        const bytes = await readFile(filename);
        response.setHeader(
          'Content-Type',
          mediaTypes[path.extname(filename)] ?? 'application/octet-stream',
        );
        response.end(bytes);
      } catch {
        response.statusCode = 404;
        response.end('Not found');
      }
    });
    server.on('connection', () => connections.push({ port, time: Date.now() }));
    server.on('upgrade', (request, socket) => {
      upgrades.push({
        port,
        path: request.url ?? '/',
        origin: request.headers.origin,
        time: Date.now(),
      });
      traffic.push({ port, path: request.url ?? '/', method: 'UPGRADE' });
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    listeners.push(server);
  }

  return {
    traffic,
    connections,
    upgrades,
    close: async () => {
      await Promise.all(
        listeners.map(
          (server) =>
            new Promise<void>((resolve) => {
              server.closeAllConnections();
              server.close(() => resolve());
            }),
        ),
      );
    },
  };
}
