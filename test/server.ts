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
}

/** Static files only, with the same separate manager/runtime roles as deployment. */
export async function servers() {
  const traffic: RequestObservation[] = [];
  const connections: Array<{ port: number; time: number }> = [];
  const listeners: http.Server[] = [];
  const publisherApps: Record<number, string> = {
    4212: 'notes',
    4213: 'image',
    4214: 'notes',
    4215: 'adversary',
    4217: 'playground',
    4218: 'ordinary',
  };

  for (const port of [4210, 4211, 4212, 4213, 4214, 4215, 4216, 4217, 4218]) {
    const server = http.createServer(async (request, response) => {
      const url = new URL(request.url ?? '/', 'http://local');
      traffic.push({ port, path: request.url ?? '/', method: request.method ?? 'GET' });
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Cache-Control', 'no-store');
      if (port === 4216) {
        response.end('diagnostic receiver');
        return;
      }

      try {
        let relative = decodeURIComponent(url.pathname);
        const trusted = port === 4210 || port === 4211;
        const prefix = port === 4211 ? '/runtime' : '/privacy-frames';
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
          config.managerOrigins = ['http://127.0.0.1:4210'];
          config.examples = [
            { name: 'Notebook', url: 'http://127.0.0.1:4212/' },
            { name: 'Image editor', url: 'http://127.0.0.1:4213/' },
            { name: 'Hostile app', url: 'http://127.0.0.1:4215/' },
            { name: 'Code playground', url: 'http://127.0.0.1:4217/' },
          ];
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify(config));
          return;
        }

        if (port === 4212 && relative === '/broken/') {
          response.setHeader('Content-Type', 'text/html');
          response.end(
            '<!doctype html><title>Broken</title><script src="missing.js"></script>',
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
          ? path.join(repository, port === 4211 ? 'dist-runtime' : 'dist-manager')
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
