import type { CapturedResponse, PreparedCache, PreparationReply } from './protocol.ts';
import { errorMessage } from './protocol.ts';
import type {
  PreparedInstallation,
  PrecacheReceipt,
  DownloadedResource,
} from '../shared/types.ts';
import { moduleReferences, relocateModule } from './modules.ts';
import { prepareDocument, cssReferences } from './document.ts';
import { digest, LIMITS, safePath } from '../shared/policy.ts';

function publicURL(input: string, base?: string | URL) {
  const url = new URL(input, base);
  url.hash = '';
  if (
    url.username ||
    url.password ||
    !['https:', 'http:'].includes(url.protocol) ||
    (url.protocol === 'http:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    throw new Error('Installation requires public HTTPS resources');
  return url;
}
export async function downloadWebsite(
  input: string,
  { onProgress = () => {} }: { onProgress?: (message: string) => void } = {},
): Promise<PreparedInstallation> {
  const source = publicURL(input),
    scope = new URL('./', source),
    downloads = new Map<
      string,
      Promise<{ url: string; bytes: ArrayBuffer; contentType: string }>
    >(),
    abort = new AbortController();
  let size = 0,
    sealed = false;
  async function download(input: string): Promise<CapturedResponse> {
    const url = publicURL(input, scope).href;
    if (sealed) throw new Error('Installation has ended');
    const existing = downloads.get(url);
    if (existing) return existing;
    if (downloads.size >= LIMITS.files)
      throw new Error('Too many installation resources');
    const promise = (async () => {
      const response = await fetch(url, {
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        signal: abort.signal,
      });
      if (!response.ok)
        throw Object.assign(new Error(`${url}: HTTP ${response.status}`), {
          status: response.status,
        });
      if (!response.body) throw new Error('Resource response has no body');
      const reader = response.body.getReader(),
        chunks = [];
      let length = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.byteLength;
        size += part.value.byteLength;
        if (size > LIMITS.bytes) {
          abort.abort();
          throw new Error('Installation exceeds size limit');
        }
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      onProgress(`Preparing… ${downloads.size} resources`);
      return {
        url,
        bytes: bytes.buffer,
        contentType: response.headers.get('Content-Type') || 'application/octet-stream',
      };
    })();
    downloads.set(url, promise);
    return promise;
  }
  let worker: Worker | undefined;
  try {
    const entry = await download(source.href),
      prepared = prepareDocument(new TextDecoder().decode(entry.bytes), source.href);
    for (const script of prepared.inlineScripts) {
      const bytes = new TextEncoder().encode(script.code).buffer;
      size += bytes.byteLength;
      downloads.set(
        script.url,
        Promise.resolve({ url: script.url, bytes, contentType: 'text/javascript' }),
      );
    }
    await Promise.all(prepared.links.map((link) => download(link)));
    let publisherManifest: PreparedInstallation['publisherManifest'] = null;
    if (prepared.manifestURL) {
      try {
        const resource = await download(prepared.manifestURL);
        const decoded: unknown = JSON.parse(new TextDecoder().decode(resource.bytes));
        const value =
          decoded && typeof decoded === 'object' && !Array.isArray(decoded)
            ? (decoded as Record<string, unknown>)
            : null;
        if (value && typeof value === 'object' && !Array.isArray(value))
          publisherManifest = { value, url: resource.url };
        const icons = (Array.isArray(value?.icons) ? value.icons : [])
          .filter(
            (icon): icon is { src: string } =>
              !!icon && typeof icon === 'object' && typeof icon.src === 'string',
          )
          .slice(0, 8);
        for (const icon of icons)
          try {
            await download(new URL(icon.src, resource.url).href);
          } catch (error) {
            downloads.delete(new URL(icon.src, resource.url).href);
            onProgress('Optional icon unavailable: ' + errorMessage(error));
          }
      } catch (error) {
        downloads.delete(prepared.manifestURL);
        onProgress('Optional manifest unavailable: ' + errorMessage(error));
      }
    }
    const discovered = new Set<string>([source.href]);
    const adaptedHTML = new Map<string, string>([[source.href, prepared.html]]);
    async function discoverResources() {
      while (true) {
        const pending = (await Promise.all(downloads.values())).filter(
          (item) =>
            /(?:text\/html|text\/css|javascript|ecmascript)/i.test(item.contentType) &&
            !discovered.has(item.url),
        );
        if (!pending.length) return;
        for (const item of pending) {
          discovered.add(item.url);
          const code = new TextDecoder().decode(item.bytes);
          let references: string[];
          if (/text\/html/i.test(item.contentType)) {
            const document = prepareDocument(code, item.url);
            adaptedHTML.set(item.url, document.html);
            for (const script of document.inlineScripts) {
              const bytes = new TextEncoder().encode(script.code).buffer;
              size += bytes.byteLength;
              downloads.set(
                script.url,
                Promise.resolve({
                  url: script.url,
                  bytes,
                  contentType: 'text/javascript',
                }),
              );
            }
            references = document.links;
          } else
            references = /text\/css/i.test(item.contentType)
              ? cssReferences(code, item.url)
              : await moduleReferences(code, item.url);
          await Promise.all(references.map(download));
        }
      }
    }
    await discoverResources();
    let receipt: PrecacheReceipt | null = null,
      caches: PreparedCache[] = [];
    const scriptURL = new URL('sw.js', scope);
    let script: CapturedResponse | undefined;
    try {
      script = await download(scriptURL.href);
    } catch (error) {
      if (!(error instanceof Error && 'status' in error && error.status === 404))
        throw error;
      downloads.delete(scriptURL.href);
    }
    if (script) {
      if (!/javascript|ecmascript/.test(script.contentType))
        throw new Error('Installation worker must be JavaScript');
      const preparationWorker = new Worker(new URL('install-worker.js', import.meta.url));
      worker = preparationWorker;
      caches = await new Promise<PreparedCache[]>((resolve, reject) => {
        const timer = setTimeout(() => {
          preparationWorker.terminate();
          reject(new Error('Installation worker timed out'));
        }, 45000);
        preparationWorker.onerror = (event) => {
          clearTimeout(timer);
          reject(new Error(event.message || 'Installation worker failed'));
        };
        preparationWorker.onmessage = async (event: MessageEvent<PreparationReply>) => {
          const data = event.data;
          if (data?.type === 'download') {
            try {
              const resource = await download(data.url);
              preparationWorker.postMessage({
                type: 'download-result',
                id: data.id,
                ok: true,
                bytes: resource.bytes,
                contentType: resource.contentType,
              });
            } catch (error) {
              preparationWorker.postMessage({
                type: 'download-result',
                id: data.id,
                ok: false,
                error: errorMessage(error),
              });
            }
          } else if (data?.type === 'prepared') {
            clearTimeout(timer);
            resolve(data.caches);
          } else if (data?.type === 'failed') {
            clearTimeout(timer);
            reject(new Error(data.error));
          }
        };
        preparationWorker.postMessage({
          type: 'prepare',
          scope: scope.href,
          scriptURL: scriptURL.href,
          code: new TextDecoder().decode(script.bytes),
        });
      });
      receipt = {
        scriptURL: scriptURL.href,
        scope: scope.href,
        completed: ['install', 'activate'],
        profile: 'precache-v1',
      };
    }
    // Preparation code has completed. Stop its context before final resource discovery.
    worker?.terminate();
    let generatedSize = 0;
    for (const cache of caches)
      for (const item of cache.entries) {
        publicURL(item.url);
        if (!(item.bytes instanceof ArrayBuffer))
          throw new Error('Invalid cached resource');
        generatedSize += item.bytes.byteLength;
        if (generatedSize > LIMITS.bytes)
          throw new Error('Installation caches exceed size limit');
        downloads.set(item.url, Promise.resolve(item));
        if (item.url !== source.href) discovered.delete(item.url);
      }
    await discoverResources();
    sealed = true;
    abort.abort();
    const collected = new Map<string, CapturedResponse>();
    for (const item of await Promise.all(downloads.values())) {
      const html = adaptedHTML.get(item.url);
      collected.set(
        item.url,
        html === undefined
          ? item
          : { ...item, bytes: new TextEncoder().encode(html).buffer },
      );
    }
    if (collected.size > LIMITS.files) throw new Error('Too many prepared resources');
    const paths = new Set(),
      resources: DownloadedResource[] = [];
    let total = 0;
    for (const item of collected.values()) {
      const url = new URL(item.url);
      let path =
        item.url === source.href
          ? 'index.html'
          : url.origin === scope.origin && url.href.startsWith(scope.href)
            ? url.pathname.slice(scope.pathname.length)
            : '';
      try {
        safePath(path);
        if (paths.has(path)) throw new Error('Duplicate path');
      } catch {
        path =
          'resources/' +
          (await digest(new TextEncoder().encode(item.url))) +
          '.' +
          (url.pathname.match(/\.([a-z0-9]{1,8})$/i)?.[1] || 'bin');
      }
      paths.add(path);
      total += item.bytes.byteLength;
      if (total > LIMITS.bytes)
        throw new Error('Prepared application exceeds size limit');
      let bytes = item.bytes;
      resources.push({ ...item, path, bytes, sha256: await digest(bytes) });
    }
    const resourcePaths = new Map<string, string>(
      resources.map((resource) => [resource.url, resource.path]),
    );
    for (const resource of resources)
      if (/javascript|ecmascript/i.test(resource.contentType)) {
        const text = new TextDecoder().decode(resource.bytes);
        const relocated = await relocateModule(
          text,
          resource.url,
          resource.path,
          resourcePaths,
        );
        if (text !== relocated) {
          resource.bytes = new TextEncoder().encode(relocated).buffer;
          resource.sha256 = await digest(resource.bytes);
        }
      }
    const label =
      (
        scope.pathname.split('/').filter(Boolean).at(-1) ||
        prepared.title.trim() ||
        source.hostname
      )
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .slice(0, 48) || 'application';
    const manifest = {
      id: label,
      name: prepared.title.trim().slice(0, 100) || label,
      entry: 'index.html',
    };
    return {
      id: label + '-' + (await digest(new TextEncoder().encode(source.href))),
      manifest,
      source: source.href,
      resources,
      publisherManifest,
      size: total,
      installedAt: new Date().toISOString(),
      preparation: {
        profile: 'website-v1',
        serviceWorker: receipt,
        caches: caches.map((cache) => ({
          name: cache.name,
          urls: cache.entries.map((entry) => entry.url),
        })),
        ended: true,
      },
    };
  } finally {
    sealed = true;
    worker?.terminate();
    abort.abort();
    await Promise.allSettled(downloads.values());
  }
}
