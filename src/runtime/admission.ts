import {
  digest,
  LIMITS,
  safePath,
  validateMarkup,
  validateMetadata,
} from '../shared/policy.ts';
import { publicAlias } from '../shared/runtime-url.ts';
import type {
  DownloadedResource,
  PreparedInstallation,
  Preparation,
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
  return { profile: 'website-v1', ended: true, caches, serviceWorker };
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
    if (path.endsWith('.html'))
      validateMarkup(new TextDecoder().decode(resource.bytes), {
        document: true,
        initial: true,
      });
    resources.push({
      path,
      url,
      bytes: resource.bytes,
      contentType: resource.contentType,
      sha256: resource.sha256 as string,
    });
  }
  const entry = resources.find((resource) => resource.path === manifest.entry);
  if (!entry) throw new Error('Missing entry');
  const receipt = preparation(value.preparation);
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
    resources,
    size,
    publisherManifest,
    installedAt: new Date().toISOString(),
    preparation: receipt,
  };
  if (
    (await listApps()).some(
      (other) => other.id !== id && publicAlias(other.id) === publicAlias(id),
    )
  )
    throw new Error('Installation alias collision');
  prepareRuntimeDocument(app, entry.bytes, runtime);
  return app;
}
