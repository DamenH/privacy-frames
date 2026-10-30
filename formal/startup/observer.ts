import type {
  ContextIdentity,
  ContextRegistry,
} from '../../src/runtime/contexts/model.ts';
const controller = self as unknown as ServiceWorkerGlobalScope;
const base = new URL('./', controller.location.href);
const cacheName = 'pf-correspondence-observer-v1';
const gateURL = new URL('__test-gate', base).href;
interface Trace {
  kind: string;
  [key: string]: unknown;
}
export async function trace(value: Trace) {
  const cache = await caches.open(cacheName);
  await cache.put(
    new URL('__test-trace/' + crypto.randomUUID(), base).href,
    new Response(JSON.stringify({ ...value, build: __BUILD_ID__, time: Date.now() })),
  );
}
export function registry(registry: ContextRegistry) {
  const bind = registry.bind.bind(registry);
  registry.bind = async (client: string, identity: ContextIdentity) => {
    await trace({
      kind: 'bind-start',
      client,
      context: identity.id,
      parent: identity.parent,
      application: identity.application,
      generation: identity.installationGeneration,
      url: identity.url,
    });
    try {
      await bind(client, identity);
      await trace({
        kind: 'bind-success',
        client,
        context: identity.id,
        parent: identity.parent,
        application: identity.application,
        generation: identity.installationGeneration,
        url: identity.url,
      });
    } catch (error) {
      await trace({
        kind: 'bind-rejected',
        client,
        context: identity.id,
        error: String(error),
      });
      throw error;
    }
  };
  return registry;
}
export function fetched(event: FetchEvent) {
  if (
    event.request.mode === 'navigate' ||
    event.request.url.includes('document-guard.js?context=')
  )
    event.waitUntil(
      trace({
        kind: 'native-fetch',
        trusted: event.isTrusted,
        client: event.clientId,
        resulting: event.resultingClientId,
        url: event.request.url,
        destination: event.request.destination,
        mode: event.request.mode,
      }),
    );
}
export async function pause(event: FetchEvent): Promise<Response | undefined> {
  const url = new URL(event.request.url);
  if (
    url.pathname !== new URL('document-guard.js', base).pathname ||
    !url.searchParams.has('context')
  )
    return;
  const cache = await caches.open(cacheName);
  const settings = await cache.match(gateURL);
  if (!settings) return;
  const mode = await settings.text();
  if (mode !== 'hold') return;
  const context = url.searchParams.get('context');
  await trace({
    kind: 'guard-paused',
    context,
    client: event.clientId,
    resulting: event.resultingClientId,
    trusted: event.isTrusted,
  });
  for (let count = 0; count < 300; count++) {
    const value = await cache.match(gateURL);
    if (value && (await value.text()) === 'release') {
      await trace({
        kind: 'guard-released',
        context,
        client: event.clientId,
        fault: false,
      });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await trace({ kind: 'guard-timeout', context, client: event.clientId });
  throw new Error('Correspondence gate timed out');
}
export async function command(event: ExtendableMessageEvent, authorized: boolean) {
  const port = event.ports[0];
  if (!port) return;
  if (!authorized) {
    port.postMessage({ ok: false, error: 'Actual manager role required' });
    return;
  }
  const value: unknown = event.data;
  if (!value || typeof value !== 'object' || !('command' in value)) return;
  const cache = await caches.open(cacheName);
  if (value.command === 'trace') {
    const rows = [];
    for (const request of await cache.keys())
      if (request.url.includes('/__test-trace/'))
        rows.push(await (await cache.match(request))!.json());
    port.postMessage({ ok: true, build: __BUILD_ID__, rows });
  } else if (['hold', 'release', 'clear'].includes(String(value.command))) {
    if (value.command === 'clear') await cache.delete(gateURL);
    else await cache.put(gateURL, new Response(String(value.command)));
    port.postMessage({ ok: true, build: __BUILD_ID__ });
  } else port.postMessage({ ok: false, error: 'Unknown command' });
}
