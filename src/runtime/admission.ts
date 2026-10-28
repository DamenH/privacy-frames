import { digest, LIMITS, safePath, validateMetadata } from '../shared/policy.ts';
import { publicAlias, resourceURL } from '../shared/runtime-url.ts';
import { compileDocumentContent } from './contexts/document-content.ts';
import type {
  DownloadedResource,
  PreparedInstallation,
  Preparation,
  UnavailableResource,
} from '../shared/types.ts';
import { prepareRuntimeDocument } from './document.ts';
import { listApps } from './storage.ts';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected an object');
  return value as Record<string, unknown>;
}

function publicURL(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected a resource URL');
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    !['https:', 'http:'].includes(url.protocol) ||
    (url.protocol === 'http:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    throw new Error('Resource requires HTTPS');
  return url.href;
}

function preparation(value: unknown): Preparation {
  const input = object(value);
  if (
    input.profile !== 'website-v1' ||
    input.ended !== true ||
    !Array.isArray(input.caches) ||
    input.caches.length > 20
  )
    throw new Error('Installation has not ended');
  const caches = input.caches.map((value) => {
    const cache = object(value);
    if (
      typeof cache.name !== 'string' ||
      cache.name.length > 1000 ||
      !Array.isArray(cache.urls) ||
      cache.urls.length > LIMITS.files
    )
      throw new Error('Invalid installation cache');
    return { name: cache.name, urls: cache.urls.map(publicURL) };
  });
  let serviceWorker: Preparation['serviceWorker'] = null;
  if (input.serviceWorker !== null) {
    const receipt = object(input.serviceWorker);
    if (
      receipt.profile !== 'precache-v1' ||
      !Array.isArray(receipt.completed) ||
      receipt.completed.length !== 2 ||
      receipt.completed[0] !== 'install' ||
      receipt.completed[1] !== 'activate'
    )
      throw new Error('Invalid preparation receipt');
    serviceWorker = {
      profile: 'precache-v1',
      completed: ['install', 'activate'],
      scriptURL: publicURL(receipt.scriptURL),
      scope: publicURL(receipt.scope),
    };
  }
  const inputOutcome = object(input.outcome);
  const unavailableResources: UnavailableResource[] = [];
  if (input.unavailableResources !== undefined) {
    if (
      !Array.isArray(input.unavailableResources) ||
      input.unavailableResources.length > LIMITS.files
    )
      throw new Error('Invalid unavailable resource diagnostics');
    const seen = new Set<string>();
    for (const item of input.unavailableResources) {
      const diagnostic = object(item);
      const url = publicURL(diagnostic.url);
      if (
        seen.has(url) ||
        !['network', 'http', 'body'].includes(String(diagnostic.reason)) ||
        (diagnostic.reason === 'http'
          ? typeof diagnostic.status !== 'number' ||
            !Number.isInteger(diagnostic.status) ||
            diagnostic.status < 100 ||
            diagnostic.status > 599 ||
            (diagnostic.status >= 200 && diagnostic.status < 300)
          : diagnostic.status !== undefined)
      )
        throw new Error('Invalid unavailable resource diagnostic');
      seen.add(url);
      unavailableResources.push({
        url,
        reason:
          diagnostic.reason === 'network'
            ? 'network'
            : diagnostic.reason === 'http'
              ? 'http'
              : 'body',
        ...(typeof diagnostic.status === 'number' ? { status: diagnostic.status } : {}),
      });
    }
  }
  let outcome: Preparation['outcome'];
  if (inputOutcome.status === 'absent') {
    outcome = { status: 'absent' };
  } else if (inputOutcome.status === 'completed') {
    outcome = { status: 'completed', scriptURL: publicURL(inputOutcome.scriptURL) };
  } else if (inputOutcome.status === 'unsupported' || inputOutcome.status === 'failed') {
    if (typeof inputOutcome.reason !== 'string' || inputOutcome.reason.length > 2000)
      throw new Error('Invalid preparation diagnostic');
    outcome = {
      status: inputOutcome.status,
      scriptURL: publicURL(inputOutcome.scriptURL),
      reason: inputOutcome.reason,
    };
  } else throw new Error('Invalid preparation outcome');
  if (outcome.status === 'completed') {
    if (!serviceWorker || serviceWorker.scriptURL !== outcome.scriptURL)
      throw new Error('Completed preparation requires its receipt');
  } else if (serviceWorker || caches.length) {
    throw new Error('Uncompleted preparation cannot publish worker authority or caches');
  }
  return {
    profile: 'website-v1',
    ended: true,
    caches,
    serviceWorker,
    outcome,
    unavailableResources,
  };
}

export async function admitInstallation(
  input: unknown,
  runtime: URL,
): Promise<PreparedInstallation> {
  const value = object(input);
  const manifest = validateMetadata(value.manifest);
  const source = publicURL(value.source);
  const id = manifest.id + '-' + (await digest(new TextEncoder().encode(source)));
  if (value.id !== id) throw new Error('Installation identity mismatch');
  if (
    !Array.isArray(value.resources) ||
    !value.resources.length ||
    value.resources.length > LIMITS.files
  )
    throw new Error('Invalid resource count');
  const paths = new Set<string>(),
    urls = new Set<string>();
  let size = 0;
  const resources: DownloadedResource[] = [];
  for (const item of value.resources) {
    const resource = object(item),
      path = safePath(resource.path),
      url = publicURL(resource.url);
    if (paths.has(path) || urls.has(url)) throw new Error('Duplicate resource');
    paths.add(path);
    urls.add(url);
    if (
      !(resource.bytes instanceof ArrayBuffer) ||
      typeof resource.contentType !== 'string' ||
      resource.contentType.length > 200
    )
      throw new Error('Invalid resource');
    size += resource.bytes.byteLength;
    if (size > LIMITS.bytes || (await digest(resource.bytes)) !== resource.sha256)
      throw new Error('Resource integrity or size check failed');
    resources.push({
      path,
      url,
      bytes: resource.bytes,
      contentType: resource.contentType,
      sha256: resource.sha256 as string,
      ...(resource.documentBase === undefined
        ? {}
        : { documentBase: publicURL(resource.documentBase) }),
    });
  }
  const entry = resources.find((resource) => resource.path === manifest.entry);
  if (!entry) throw new Error('Missing entry');
  const receipt = preparation(value.preparation);
  if (receipt.unavailableResources?.some((item) => urls.has(item.url)))
    throw new Error('Unavailable resource is also installed');
  for (const cache of receipt.caches)
    for (const url of cache.urls)
      if (!urls.has(url)) throw new Error('Cache contains an uninstalled resource');
  let publisherManifest: PreparedInstallation['publisherManifest'] = null;
  if (value.publisherManifest) {
    const metadata = object(value.publisherManifest);
    publisherManifest = { url: publicURL(metadata.url), value: object(metadata.value) };
  }
  const app: PreparedInstallation = {
    id,
    manifest,
    source,
    documentBase:
      value.documentBase === undefined ? source : publicURL(value.documentBase),
    resources,
    size,
    publisherManifest,
    installedAt: new Date().toISOString(),
    preparation: receipt,
  };
  const aliases: [string, string][] = resources.map((resource) => [
    resource.url,
    resourceURL(app, resource.path, runtime).href,
  ]);
  for (const resource of resources)
    if (
      resource.path.endsWith('.html') ||
      resource.contentType.split(';')[0].trim().toLowerCase() === 'text/html'
    )
      compileDocumentContent({
        kind: 'html',
        text: new TextDecoder().decode(resource.bytes),
        sourceURL: resource.url,
        baseURL:
          resource.documentBase ||
          (resource.url === source ? app.documentBase : undefined) ||
          resource.url,
        aliases,
        unavailableURLs: receipt.unavailableResources?.map((item) => item.url),
      });
  if (
    (await listApps()).some(
      (other) => other.id !== id && publicAlias(other.id) === publicAlias(id),
    )
  )
    throw new Error('Installation alias collision');
  prepareRuntimeDocument(app, entry.bytes, runtime);
  return app;
}
