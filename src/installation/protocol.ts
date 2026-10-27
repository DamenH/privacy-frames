import { LIMITS } from '../shared/policy.ts';

export interface CapturedResponse {
  url: string;
  bytes: ArrayBuffer;
  contentType: string;
}
export interface PreparedCache {
  name: string;
  entries: CapturedResponse[];
}
export type PreparationRequest =
  | { type: 'prepare'; scope: string; scriptURL: string; code: string }
  | {
      type: 'download-result';
      id: number;
      ok: true;
      bytes: ArrayBuffer;
      contentType: string;
    }
  | { type: 'download-result'; id: number; ok: false; error: string };
export type PreparationReply =
  | { type: 'download'; id: number; url: string }
  | { type: 'prepared'; caches: PreparedCache[] }
  | { type: 'failed'; status: 'unsupported' | 'failed'; error: string };
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid preparation response');
  return value as Record<string, unknown>;
}

/** Validate the worker boundary before promoting any captured installation data. */
export function preparationReply(value: unknown): PreparationReply {
  const data = record(value);
  if (data.type === 'download') {
    if (
      !Number.isSafeInteger(data.id) ||
      typeof data.id !== 'number' ||
      data.id < 1 ||
      typeof data.url !== 'string'
    )
      throw new Error('Invalid preparation download');
    return { type: 'download', id: data.id, url: data.url };
  }
  if (data.type === 'failed') {
    if (
      (data.status !== 'unsupported' && data.status !== 'failed') ||
      typeof data.error !== 'string'
    )
      throw new Error('Invalid preparation failure');
    return { type: 'failed', status: data.status, error: data.error };
  }
  if (data.type !== 'prepared' || !Array.isArray(data.caches) || data.caches.length > 20)
    throw new Error('Invalid preparation completion');
  const caches = data.caches.map((value): PreparedCache => {
    const cache = record(value);
    if (
      typeof cache.name !== 'string' ||
      cache.name.length > 1000 ||
      !Array.isArray(cache.entries) ||
      cache.entries.length > LIMITS.files
    )
      throw new Error('Invalid preparation cache');
    return {
      name: cache.name,
      entries: cache.entries.map((value): CapturedResponse => {
        const entry = record(value);
        if (
          typeof entry.url !== 'string' ||
          !(entry.bytes instanceof ArrayBuffer) ||
          typeof entry.contentType !== 'string' ||
          entry.contentType.length > 200
        )
          throw new Error('Invalid preparation resource');
        return { url: entry.url, bytes: entry.bytes, contentType: entry.contentType };
      }),
    };
  });
  return { type: 'prepared', caches };
}
