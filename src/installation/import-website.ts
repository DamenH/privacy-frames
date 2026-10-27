import type { PreparedCache, PreparationReply } from './protocol.ts';
import { errorMessage, preparationReply } from './protocol.ts';
import type {
  PreparedInstallation,
  PrecacheReceipt,
  PreparationOutcome,
} from '../shared/types.ts';
import { prepareDocument } from './document.ts';
import { digest, LIMITS } from '../shared/policy.ts';
import { ResourceCapture, publicResourceURL } from './resource-capture.ts';
import type { FinalizedResources, ScriptDiscoveryEvent } from './resource-capture.ts';
import { prepareRuntimeDocument } from '../runtime/document.ts';

export async function downloadWebsite(
  input: string,
  {
    onProgress = () => {},
    onDiscovery = () => {},
  }: {
    onProgress?: (message: string) => void;
    onDiscovery?: (event: ScriptDiscoveryEvent) => void;
  } = {},
): Promise<PreparedInstallation> {
  const source = publicResourceURL(input);
  const scope = new URL('./', source);
  const capture = new ResourceCapture(source, scope, onProgress, onDiscovery);
  const independent = capture.graph();
  let worker: Worker | undefined;
  try {
    const entry = await capture.download(source.href, independent);
    const prepared = prepareDocument(new TextDecoder().decode(entry.bytes), source.href);
    const label =
      (
        scope.pathname.split('/').filter(Boolean).at(-1) ||
        prepared.title.trim() ||
        source.hostname
      )
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .slice(0, 48) || 'application';
    const id = label + '-' + (await digest(new TextEncoder().encode(source.href)));
    const application = (
      finalized: FinalizedResources,
      receipt: PrecacheReceipt | null,
      caches: PreparedCache[],
      outcome: PreparationOutcome,
    ): PreparedInstallation => ({
      id,
      manifest: {
        id: label,
        name: prepared.title.trim().slice(0, 100) || label,
        entry: 'index.html',
      },
      source: source.href,
      documentBase: prepared.baseURL,
      ...finalized,
      publisherManifest,
      installedAt: new Date().toISOString(),
      preparation: {
        profile: 'website-v1',
        serviceWorker: receipt,
        caches: caches.map((cache) => ({
          name: cache.name,
          urls: cache.entries.map((entry) => entry.url),
        })),
        outcome,
        ended: true,
      },
    });
    const validateDocument = (candidate: PreparedInstallation) => {
      const entry = candidate.resources.find(
        (resource) => resource.path === candidate.manifest.entry,
      );
      if (!entry) throw new Error('Missing prepared entry');
      // The runtime independently repeats this pure document compilation at admission.
      prepareRuntimeDocument(
        candidate,
        entry.bytes,
        new URL('https://validation.invalid/'),
      );
    };

    capture.document(prepared, source.href, independent);
    await Promise.all(prepared.links.map((url) => capture.download(url, independent)));
    let publisherManifest: PreparedInstallation['publisherManifest'] = null;
    if (prepared.manifestURL) {
      try {
        const resource = await capture.download(prepared.manifestURL, independent);
        const decoded: unknown = JSON.parse(new TextDecoder().decode(resource.bytes));
        const value =
          decoded && typeof decoded === 'object' && !Array.isArray(decoded)
            ? (decoded as Record<string, unknown>)
            : null;
        if (value) publisherManifest = { value, url: resource.url };
        const icons = (Array.isArray(value?.icons) ? value.icons : [])
          .filter(
            (icon): icon is { src: string } =>
              !!icon && typeof icon === 'object' && typeof icon.src === 'string',
          )
          .slice(0, 8);
        for (const icon of icons) {
          const url = new URL(icon.src, resource.url).href;
          try {
            await capture.download(url, independent);
          } catch (error) {
            independent.downloads.delete(url);
            onProgress('Optional icon unavailable: ' + errorMessage(error));
          }
        }
      } catch (error) {
        independent.downloads.delete(prepared.manifestURL);
        onProgress('Optional manifest unavailable: ' + errorMessage(error));
      }
    }
    await capture.discover(independent);
    // Admission of this graph is independent of publisher preparation succeeding.
    let finalized = await capture.finalize(independent);
    validateDocument(application(finalized, null, [], { status: 'absent' }));
    let receipt: PrecacheReceipt | null = null;
    let caches: PreparedCache[] = [];
    let outcome: PreparationOutcome = { status: 'absent' };
    const scriptURL = new URL('sw.js', scope);
    const stage = capture.graph(independent);
    let brokerOpen = true;
    let scriptFound = false;
    const stageTimer = setTimeout(() => {
      stage.controller.abort(
        new DOMException('Optional precaching timed out', 'TimeoutError'),
      );
    }, 45000);
    try {
      const script = await capture.download(scriptURL.href, stage);
      scriptFound = true;
      if (!/javascript|ecmascript/i.test(script.contentType)) {
        outcome = {
          status: 'unsupported',
          scriptURL: scriptURL.href,
          reason: 'Installation worker must be JavaScript',
        };
      } else {
        const preparationWorker = new Worker(
          new URL('install-worker.js', import.meta.url),
        );
        worker = preparationWorker;
        const result = await new Promise<PreparationReply>((resolve, reject) => {
          const signal = stage.controller.signal;
          const stop = () => {
            brokerOpen = false;
            preparationWorker.onmessage = null;
            preparationWorker.onerror = null;
            preparationWorker.terminate();
            signal.removeEventListener('abort', aborted);
          };
          const fail = (error: unknown) => {
            stop();
            reject(error);
          };
          const aborted = () => fail(signal.reason);
          const finish = (value: PreparationReply) => {
            stop();
            resolve(value);
          };
          signal.addEventListener('abort', aborted, { once: true });
          if (signal.aborted) {
            aborted();
            return;
          }
          preparationWorker.onerror = (event) => {
            fail(new Error(event.message || 'Installation worker failed'));
          };
          preparationWorker.onmessage = async (event: MessageEvent<unknown>) => {
            if (!brokerOpen) return;
            let data: PreparationReply;
            try {
              data = preparationReply(event.data);
            } catch (error) {
              fail(error);
              return;
            }
            if (data.type !== 'download') {
              finish(data);
              return;
            }
            try {
              const resource = await capture.download(data.url, stage);
              if (!brokerOpen) return;
              preparationWorker.postMessage({
                type: 'download-result',
                id: data.id,
                ok: true,
                bytes: resource.bytes,
                contentType: resource.contentType,
              });
            } catch (error) {
              if (!brokerOpen) return;
              preparationWorker.postMessage({
                type: 'download-result',
                id: data.id,
                ok: false,
                error: errorMessage(error),
              });
            }
          };
          preparationWorker.postMessage({
            type: 'prepare',
            scope: scope.href,
            scriptURL: scriptURL.href,
            code: new TextDecoder().decode(script.bytes),
          });
        });
        if (result.type === 'failed') {
          outcome = {
            status: result.status,
            scriptURL: scriptURL.href,
            reason: result.error.slice(0, 2000),
          };
        } else if (result.type === 'prepared') {
          const stagedCaches = normalizeCaches(result.caches);
          for (const cache of stagedCaches) {
            for (const resource of cache.entries) {
              capture.replace(resource, stage);
            }
          }
          await capture.discover(stage);
          const stagedResources = await capture.finalize(stage);
          const completedReceipt: PrecacheReceipt = {
            scriptURL: scriptURL.href,
            scope: scope.href,
            completed: ['install', 'activate'],
            profile: 'precache-v1',
          };
          validateDocument(
            application(stagedResources, completedReceipt, stagedCaches, {
              status: 'completed',
              scriptURL: scriptURL.href,
            }),
          );
          // Promote only after the entire staged graph has passed the normal checks.
          finalized = stagedResources;
          caches = stagedCaches;
          receipt = completedReceipt;
          outcome = { status: 'completed', scriptURL: scriptURL.href };
        } else {
          throw new Error('Installation worker did not complete');
        }
      }
    } catch (error) {
      outcome =
        !scriptFound &&
        error instanceof Error &&
        'status' in error &&
        error.status === 404
          ? { status: 'absent' }
          : {
              status: 'failed',
              scriptURL: scriptURL.href,
              reason: errorMessage(error).slice(0, 2000),
            };
    } finally {
      clearTimeout(stageTimer);
      brokerOpen = false;
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
        worker = undefined;
      }
      await capture.close(stage);
    }
    if (outcome.status === 'unsupported' || outcome.status === 'failed')
      onProgress(`Optional precaching ${outcome.status}: ${outcome.reason}`);
    return application(finalized, receipt, caches, outcome);
  } finally {
    worker?.terminate();
    await capture.closeAll();
  }
}

function normalizeCaches(caches: PreparedCache[]): PreparedCache[] {
  const names = new Set<string>();
  let size = 0;
  return caches.map((cache) => {
    if (names.has(cache.name)) throw new Error('Duplicate installation cache');
    names.add(cache.name);
    const entries = new Map<string, PreparedCache['entries'][number]>();
    for (const resource of cache.entries) {
      size += resource.bytes.byteLength;
      if (size > LIMITS.bytes) throw new Error('Installation caches exceed size limit');
      const url = publicResourceURL(resource.url).href;
      entries.set(url, { ...resource, url });
    }
    return { name: cache.name, entries: [...entries.values()] };
  });
}
