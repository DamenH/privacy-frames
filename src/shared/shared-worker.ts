import { strings, internalRecord, internalData } from './primordials.ts';
export type SharedWorkerType = 'classic' | 'module';
export interface SharedWorkerIdentity {
  application: string;
  installationGeneration: string;
}
export interface SharedWorkerSource {
  source: string;
  type: SharedWorkerType;
  name: string;
}
export interface SharedWorkerTicket extends SharedWorkerIdentity {
  ticket: string;
  key: string;
  bootstrapURL: string;
}
export interface SharedWorkerConnection extends SharedWorkerIdentity {
  key: string;
  connection: string;
}
const stringify = JSON.stringify;
const parse = JSON.parse;
const isArray = Array.isArray;

/** A native worker name partitions sharing without putting app data in its URL. */
export function sharedWorkerKey(
  identity: SharedWorkerIdentity,
  source: SharedWorkerSource,
) {
  return (
    'privacy-shared-v1:' +
    stringify([
      identity.application,
      identity.installationGeneration,
      source.source,
      source.type,
      source.name,
    ])
  );
}
export function parseSharedWorkerKey(
  key: string,
): (SharedWorkerIdentity & SharedWorkerSource) | undefined {
  if (!strings.startsWith(key, 'privacy-shared-v1:')) return;
  let fields: unknown;
  try {
    fields = internalData(parse(strings.slice(key, 'privacy-shared-v1:'.length)));
  } catch {
    return;
  }
  if (
    !isArray(fields) ||
    fields.length !== 5 ||
    fields.some((value) => typeof value !== 'string') ||
    !fields[0] ||
    !fields[1] ||
    !fields[2] ||
    !['classic', 'module'].includes(fields[3])
  )
    return;
  return internalRecord({
    application: fields[0],
    installationGeneration: fields[1],
    source: fields[2],
    type: fields[3] as SharedWorkerType,
    name: fields[4],
  });
}
