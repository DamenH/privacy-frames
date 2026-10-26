import { webManifest, manifestURL } from './pwa.ts';
import { getApp, listApps, putApp, deleteApp, getResource } from './storage.ts';
import { mime } from '../shared/policy.ts';
import {
  applicationURL,
  applicationIdentity,
  resourceURL,
  publicAlias,
} from '../shared/runtime-url.ts';
import type { RuntimeEvent } from '../shared/types.ts';
import { response } from './response-policy.ts';
import { css, prepareRuntimeDocument } from './document.ts';
import { admitInstallation } from './admission.ts';
const worker = self as unknown as ServiceWorkerGlobalScope;
const BASE = new URL('./', worker.location.href);
const trustedFiles = [
  'index.html',
  'host.css',
  'config.json',
  'report.html',
  'pwa-192.png',
  'pwa-512.png',
  'guard.js',
  'connect.html',
  'connect.js',
];
function isManagerURL(input: string | undefined) {
  if (!input) return false;
  try {
    const u = new URL(input);
    return (
      u.origin === BASE.origin &&
      !u.search &&
      [BASE.pathname + 'connect.html'].includes(u.pathname)
    );
  } catch {
    return false;
  }
}
const BOOT = 'pf-trusted-bootstrap-' + __BUILD_ID__;
// Management roles are issued only to trusted document loads, then bound to the
// browser client ID. Changing a URL or supplying a claimed role is insufficient.
const ROLES = 'pf-management-clients-v1';
const roleURL = (id: string) =>
  new URL('__host-client/' + encodeURIComponent(id), BASE).href;
async function grantManagement(id: string) {
  if (id) await (await caches.open(ROLES)).put(roleURL(id), new Response('manager'));
}
async function hasManagement(id: string | undefined) {
  return !!id && !!(await (await caches.open(ROLES)).match(roleURL(id)));
}
const events: RuntimeEvent[] = [];
function record(kind: string, url: string, method: string) {
  events.push({ kind, url, method, time: new Date().toISOString() });
  if (events.length > 300) events.shift();
}
worker.addEventListener('install', (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(BOOT);
      await cache.addAll(trustedFiles.map((p) => new URL(p, BASE).href));
      await worker.skipWaiting();
    })(),
  ),
);
worker.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      await worker.clients.claim();
    })(),
  ),
);
async function runtimeIdentity(url: string | undefined): Promise<string | null> {
  if (!url) return null;
  const key = applicationIdentity(url, BASE);
  if (!key) return null;
  const matches = (await listApps()).filter((app) => publicAlias(app.id) === key);
  return matches.length === 1 ? matches[0].id : null;
}
let managementQueue = Promise.resolve();
worker.addEventListener('message', (event) => {
  const port = event.ports[0];
  if (!port) return;
  const operation = managementQueue.then(async () => {
    try {
      const client =
        event.source && 'id' in event.source
          ? await worker.clients.get(event.source.id)
          : undefined;
      if (!client || !isManagerURL(client.url) || !(await hasManagement(client.id)))
        throw new Error('Management client not authorized');
      const message: unknown = event.data;
      if (!message || typeof message !== 'object' || !('operation' in message))
        throw new Error('Invalid manager message');
      const operation = message.operation;
      const payload = 'payload' in message ? message.payload : undefined;
      let value;
      if (operation === 'install') {
        const app = await admitInstallation(payload, BASE);
        const windows = await worker.clients.matchAll({ type: 'window' });
        if (
          (await Promise.all(windows.map((c) => runtimeIdentity(c.url)))).includes(app.id)
        )
          throw new Error('Close application windows before replacing an installation');
        for (const stage of app.preparation?.caches || []) {
          if (
            typeof stage.name !== 'string' ||
            stage.name.length > 1000 ||
            !Array.isArray(stage.urls)
          )
            throw new Error('Invalid installation cache');
          const cache = await caches.open(`pf:${app.id}:` + stage.name);
          for (const url of stage.urls) {
            const resource = app.resources.find((r) => r.url === url);
            if (!resource) throw new Error('Cache contains an uninstalled resource');
            await cache.put(
              new Request(url),
              new Response(resource.bytes, {
                headers: { 'Content-Type': resource.contentType || mime(resource.path) },
              }),
            );
          }
        }
        app.installedAt = new Date().toISOString();
        await putApp(app);
        value = { id: app.id };
      } else if (operation === 'list')
        value = (await listApps()).map((a) => ({
          id: a.id,
          manifest: a.manifest,
          source: a.source,
          installedAt: a.installedAt,
          size: a.size,
        }));
      else if (operation === 'remove') {
        if (typeof payload !== 'string') throw new Error('Invalid installation identity');
        const windows = await worker.clients.matchAll({ type: 'window' });
        if (
          (await Promise.all(windows.map((c) => runtimeIdentity(c.url)))).includes(
            payload,
          )
        )
          throw new Error('Close application windows before uninstalling');
        await deleteApp(payload);
        value = true;
      } else if (operation === 'events') value = events;
      else throw new Error('Unknown operation');
      port.postMessage({ ok: true, value });
    } catch (e) {
      port.postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
  managementQueue = operation.catch(() => {});
  event.waitUntil(operation);
});
worker.addEventListener('fetch', (event) => {
  event.respondWith(
    (async () => {
      const req = event.request,
        url = new URL(req.url),
        client = event.clientId ? await worker.clients.get(event.clientId) : null;
      // Fragments are application-local routing state, including on reload. They do
      // not select a different installed document or authorize a resource request.
      url.hash = '';
      // Browsers may fetch manifests/icons without an application client. These
      // fixed routes expose only public installation metadata and captured icons.
      const publicPath =
        url.origin === BASE.origin && url.pathname.startsWith(BASE.pathname)
          ? url.pathname.slice(BASE.pathname.length)
          : '';
      const publicRoute = publicPath.match(
        /^([A-Za-z0-9_-]{11})\/(__manifest\.webmanifest|__icon\/(\d+))$/,
      );
      if (publicRoute && req.method === 'GET' && !url.search && req.mode !== 'navigate') {
        const apps = (await listApps()).filter(
          (app) => publicAlias(app.id) === publicRoute[1],
        );
        if (apps.length === 1) {
          const app = apps[0];
          if (publicRoute[2] === '__manifest.webmanifest')
            return response(
              JSON.stringify(webManifest(app, BASE)),
              'application/manifest+json',
            );
          const resource = app.resources[Number(publicRoute[3])];
          const admitted = webManifest(app, BASE).icons.some(
            (icon) => new URL(icon.src, BASE).href === url.href,
          );
          if (admitted && resource)
            return response(
              await getResource(app.id, resource.path),
              resource.contentType,
            );
        }
        return Response.error();
      }
      if (
        req.method === 'GET' &&
        !url.search &&
        ['pwa-192.png', 'pwa-512.png'].some(
          (path) => url.href === new URL(path, BASE).href,
        ) &&
        req.mode !== 'navigate'
      )
        return (await (await caches.open(BOOT)).match(url.href)) || Response.error();
      const id =
        (await runtimeIdentity(client?.url)) ||
        (req.mode === 'navigate' ? await runtimeIdentity(url.href) : null);
      const isTrusted =
        url.origin === BASE.origin &&
        trustedFiles.some((p) => url.href === new URL(p, BASE).href);
      const manager = isManagerURL(client?.url) && (await hasManagement(client?.id));
      const readOnlyHost =
        client?.url === new URL('report.html', BASE).href ||
        [BASE.href, new URL('index.html', BASE).href].includes(client?.url || '');
      const managerNavigation = req.mode === 'navigate' && isManagerURL(url.href);
      const hostDocument =
        req.mode === 'navigate' &&
        (url.href === new URL('report.html', BASE).href ||
          [BASE.href, new URL('index.html', BASE).href].includes(url.href));
      if (!id && managerNavigation) await grantManagement(event.resultingClientId);
      if (
        req.method === 'GET' &&
        url.href === BASE.href &&
        !id &&
        (managerNavigation || manager || hostDocument)
      ) {
        return (
          (await (await caches.open(BOOT)).match(new URL('index.html', BASE).href)) ||
          Response.error()
        );
      }
      if (
        isTrusted &&
        req.method === 'GET' &&
        ((!id && (manager || readOnlyHost || managerNavigation || hostDocument)) ||
          (url.href === new URL('guard.js', BASE).href && id))
      ) {
        const cached = await (await caches.open(BOOT)).match(url.href);
        return cached || Response.error();
      }
      if (!id) {
        record('blocked-unmanaged', req.url, req.method);
        return Response.error();
      }
      const app = await getApp(id);
      if (!app) return response('<h1>Application not installed</h1>', 'text/html', 404);
      const entry = applicationURL(app, BASE);
      if (req.mode === 'navigate') {
        // Any attempt to use a different document is refused. Bootstrap contains no untrusted markup.
        if (req.method === 'GET' && url.origin === entry.origin && !url.search) {
          const parts = url.pathname.slice(BASE.pathname.length).split('/');
          if (
            parts[0] === publicAlias(app.id) &&
            (parts.length <= 2 ||
              (parts.length === 3 && parts[2] === '') ||
              (parts.length === 3 && parts[2] === app.manifest.entry)) &&
            url.href !== entry.href
          )
            return new Response(null, { status: 302, headers: { Location: entry.href } });
        }
        if (url.href !== entry.href || req.method !== 'GET') {
          record('blocked-navigation', req.url, req.method);
          return Response.error();
        }
        const script = new URL('guard.js', BASE).href;
        return response(
          `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${app.manifest.name.replace(/[&<>"]/g, (c) => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }) as Record<string, string>)[c] || c)}</title><link rel="manifest" href="${manifestURL(app, BASE).href}"></head><body><script src="${script}" data-installation="${app.id}"></script></body></html>`,
        );
      }
      if (
        url.origin === entry.origin &&
        url.pathname === entry.pathname &&
        url.search === '?host-content=1' &&
        req.method === 'GET'
      )
        return response(
          JSON.stringify(
            prepareRuntimeDocument(
              app,
              await getResource(app.id, app.manifest.entry),
              BASE,
            ),
          ),
          'application/json',
        );
      if (req.method === 'GET') {
        const original =
          app.preparation?.ended && url.origin === BASE.origin
            ? new URL(url.pathname + url.search, new URL(app.source).origin).href
            : null;
        const resource = app.resources.find(
          (r) =>
            resourceURL(app, r.path, BASE).href === url.href ||
            r.url === url.href ||
            (original && r.url === original),
        );
        if (resource) {
          record('installed', req.url, req.method);
          return response(
            resource.path.endsWith('.css')
              ? css(
                  app,
                  new TextDecoder().decode(await getResource(app.id, resource.path)),
                  resource.url,
                  BASE,
                )
              : await getResource(app.id, resource.path),
            resource.contentType || mime(resource.path),
          );
        }
      }
      record('blocked', req.url, req.method);
      return Response.error();
    })().catch((error) => {
      console.error(error);
      return Response.error();
    }),
  );
});
