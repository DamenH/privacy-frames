import {
  internalArray,
  ownDescriptor,
  internalRecord,
} from '../../shared/primordials.ts';
import { parseDocumentSurface, type DocumentSurface } from './document-surface.ts';
import {
  compileDocumentContent,
  type CompiledDocumentContent,
  type DocumentContentInput,
} from './document-content.ts';
import { CONTEXT_POLICY_VERSION } from './model.ts';

export interface DocumentIntentActor {
  application: string;
  installationGeneration: string;
  parentClient: string;
}
export interface DocumentIntentKey {
  id: string;
  nonce: string;
}
export type DocumentIntentState = 'issued' | 'bound' | 'consumed' | 'closed';
export interface DocumentIntentMetadata
  extends DocumentIntentActor, DocumentIntentKey, DocumentSurface {
  parentToken: string;
  policyVersion: number;
  kind: 'html' | 'svg';
  state: DocumentIntentState;
  childClient: string | null;
}
export interface DocumentIntentContent {
  metadata: DocumentIntentMetadata;
  input: DocumentContentInput;
  compiled: CompiledDocumentContent;
}
interface StoredIntent extends DocumentIntentMetadata {
  input?: DocumentContentInput;
}
interface StoreOptions {
  databaseName?: string;
  factory?: IDBFactory;
}

const DATABASE = 'privacy-frames-document-intents-v2';
const TABLE = 'intents';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const mintUUID = crypto.randomUUID.bind(crypto);
const encoder = new TextEncoder();
const MAX_TEXT_BYTES = 100 * 1024 * 1024;

function field(value: unknown, name: string): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid document intent record');
  const property = ownDescriptor(value, name);
  if (!property) return undefined;
  if (!('value' in property)) throw new Error('Document intent accessors are not data');
  return property.value;
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value))
    throw new Error('Invalid document intent identifier');
  return value;
}
function label(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new Error('Invalid document intent identity');
  return value;
}
function actor(value: unknown): DocumentIntentActor {
  return internalRecord({
    application: label(field(value, 'application')),
    installationGeneration: label(field(value, 'installationGeneration')),
    parentClient: label(field(value, 'parentClient')),
  });
}
function address(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid document source URL');
  return new URL(value).href;
}
function contentInput(value: unknown): DocumentContentInput {
  const kind = field(value, 'kind');
  const text = field(value, 'text');
  if (
    (kind !== 'html' && kind !== 'svg') ||
    typeof text !== 'string' ||
    encoder.encode(text).byteLength > MAX_TEXT_BYTES
  )
    throw new Error('Invalid document content input');
  const aliases = field(value, 'aliases');
  if (!Array.isArray(aliases)) throw new Error('Invalid document resource aliases');
  const copiedAliases = internalArray<[string, string]>();
  for (const alias of aliases) {
    if (!Array.isArray(alias) || alias.length !== 2)
      throw new Error('Invalid document resource alias');
    const source = address(alias[0]);
    const destination = new URL(address(alias[1]));
    if (
      !['http:', 'https:'].includes(destination.protocol) ||
      destination.username ||
      destination.password ||
      destination.hash ||
      new URL(source).hash
    )
      throw new Error('Invalid document resource alias');
    copiedAliases.push([source, destination.href]);
  }
  const base = field(value, 'baseURL');
  return internalRecord({
    kind,
    text,
    sourceURL: address(field(value, 'sourceURL')),
    ...(base === undefined
      ? internalRecord({})
      : internalRecord({ baseURL: address(base) })),
    aliases: copiedAliases,
  });
}
function stored(value: unknown): StoredIntent {
  const kind = field(value, 'kind');
  const state = field(value, 'state');
  const child = field(value, 'childClient');
  const input = field(value, 'input');
  if (
    field(value, 'policyVersion') !== CONTEXT_POLICY_VERSION ||
    (kind !== 'html' && kind !== 'svg') ||
    (state !== 'issued' &&
      state !== 'bound' &&
      state !== 'consumed' &&
      state !== 'closed') ||
    (child !== null && typeof child !== 'string') ||
    (state === 'issued' && child !== null) ||
    ((state === 'bound' || state === 'consumed') && !child) ||
    ((state === 'issued' || state === 'bound') && input === undefined) ||
    ((state === 'consumed' || state === 'closed') && input !== undefined)
  )
    throw new Error('Invalid persisted document intent');
  if (
    state !== 'issued' &&
    state !== 'bound' &&
    state !== 'consumed' &&
    state !== 'closed'
  )
    throw new Error('Invalid document intent state');
  const body = input === undefined ? undefined : contentInput(input);
  if (body && body.kind !== kind) throw new Error('Document intent kind changed');
  return internalRecord({
    ...actor(value),
    ...parseDocumentSurface(value),
    id: identifier(field(value, 'id')),
    nonce: identifier(field(value, 'nonce')),
    parentToken: identifier(field(value, 'parentToken')),
    policyVersion: CONTEXT_POLICY_VERSION,
    kind,
    state,
    childClient: child === null ? null : label(child),
    ...(body ? internalRecord({ input: body }) : internalRecord({})),
  });
}
function metadata(value: StoredIntent): DocumentIntentMetadata {
  return internalRecord({
    id: value.id,
    nonce: value.nonce,
    parentToken: value.parentToken,
    policyVersion: value.policyVersion,
    application: value.application,
    installationGeneration: value.installationGeneration,
    parentClient: value.parentClient,
    kind: value.kind,
    carrier: value.carrier,
    ...(value.popup
      ? internalRecord({ popup: internalRecord({ ...value.popup }) })
      : internalRecord({})),
    state: value.state,
    childClient: value.childClient,
  });
}
function owns(value: StoredIntent, owner: DocumentIntentActor): boolean {
  return (
    value.application === owner.application &&
    value.installationGeneration === owner.installationGeneration &&
    value.parentClient === owner.parentClient
  );
}
function content(value: StoredIntent): DocumentIntentContent {
  if (!value.input) throw new Error('Document intent content was removed');
  return internalRecord({
    metadata: metadata(value),
    input: value.input,
    compiled: compileDocumentContent(value.input),
  });
}

/** Private controller storage. Application IndexedDB names are separately prefixed. */
export class DocumentIntentStore {
  private readonly factory: IDBFactory;
  private readonly databaseName: string;
  private connection: Promise<IDBDatabase> | undefined;

  constructor(options: StoreOptions = internalRecord({})) {
    this.factory = options.factory || indexedDB;
    this.databaseName = options.databaseName || DATABASE;
  }

  private open(): Promise<IDBDatabase> {
    if (!this.connection) {
      this.connection = new Promise((resolve, reject) => {
        const request = this.factory.open(this.databaseName, 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore(TABLE, internalRecord({ keyPath: 'id' }));
        request.onerror = () =>
          reject(request.error || new Error('Document intent database failed'));
        request.onsuccess = () => {
          const database = request.result;
          database.onversionchange = () => {
            database.close();
            this.connection = undefined;
          };
          resolve(database);
        };
      });
      this.connection.catch(() => {
        this.connection = undefined;
      });
    }
    return this.connection;
  }

  private async transaction<T>(
    mode: IDBTransactionMode,
    operation: (
      table: IDBObjectStore,
      finish: (result: T) => void,
      fail: (error: unknown) => void,
    ) => void,
  ): Promise<T> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(TABLE, mode);
      let result: T;
      let finished = false;
      let failure: unknown;
      transaction.oncomplete = () =>
        finished
          ? resolve(result)
          : reject(new Error('Document intent transaction produced no result'));
      transaction.onabort = () =>
        reject(
          failure ||
            transaction.error ||
            new Error('Document intent transaction aborted'),
        );
      const fail = (error: unknown) => {
        failure = error;
        transaction.abort();
      };
      try {
        operation(
          transaction.objectStore(TABLE),
          (value) => {
            result = value;
            finished = true;
          },
          fail,
        );
      } catch (error) {
        fail(error);
      }
    });
  }

  private record<T>(
    id: string,
    mode: IDBTransactionMode,
    operation: (value: StoredIntent | undefined, table: IDBObjectStore) => T,
  ): Promise<T> {
    identifier(id);
    return this.transaction(mode, (table, finish, fail) => {
      const request = table.get(id);
      request.onsuccess = () => {
        try {
          const value: unknown = request.result;
          const validated = value === undefined ? undefined : stored(value);
          if (validated && validated.id !== id)
            throw new Error('Document intent key mismatch');
          finish(operation(validated, table));
        } catch (error) {
          fail(error);
        }
      };
    });
  }

  async issue(
    authenticatedActor: DocumentIntentActor,
    input: DocumentContentInput,
    surface: DocumentSurface = internalRecord({ carrier: 'frame' }),
  ): Promise<DocumentIntentMetadata> {
    const owner = actor(authenticatedActor);
    const body = contentInput(input);
    compileDocumentContent(body);
    const value: StoredIntent = internalRecord({
      ...owner,
      ...parseDocumentSurface(surface),
      id: mintUUID(),
      nonce: mintUUID(),
      parentToken: mintUUID(),
      policyVersion: CONTEXT_POLICY_VERSION,
      kind: body.kind,
      state: 'issued',
      childClient: null,
      input: body,
    });
    return this.transaction('readwrite', (table, finish) => {
      table.add(value);
      finish(metadata(value));
    });
  }

  inspect(id: string): Promise<DocumentIntentMetadata | undefined> {
    return this.record(id, 'readonly', (value) => (value ? metadata(value) : undefined));
  }

  bind(
    key: DocumentIntentKey,
    actualChildClient: string,
    currentGeneration: string,
  ): Promise<DocumentIntentMetadata | undefined> {
    const id = identifier(key.id),
      nonce = identifier(key.nonce),
      child = label(actualChildClient),
      generation = label(currentGeneration);
    return this.record(id, 'readwrite', (value, table) => {
      if (
        !value ||
        value.state !== 'issued' ||
        value.nonce !== nonce ||
        value.installationGeneration !== generation
      )
        return;
      const next: StoredIntent = internalRecord({
        ...value,
        state: 'bound',
        childClient: child,
      });
      table.put(next);
      return metadata(next);
    });
  }

  read(
    key: DocumentIntentKey,
    actualChildClient: string,
    currentGeneration: string,
  ): Promise<DocumentIntentContent | undefined> {
    return this.body(key, actualChildClient, currentGeneration, false);
  }

  consume(
    key: DocumentIntentKey,
    actualChildClient: string,
    currentGeneration: string,
  ): Promise<DocumentIntentContent | undefined> {
    return this.body(key, actualChildClient, currentGeneration, true);
  }

  private body(
    key: DocumentIntentKey,
    actualChildClient: string,
    currentGeneration: string,
    consume: boolean,
  ): Promise<DocumentIntentContent | undefined> {
    const id = identifier(key.id),
      nonce = identifier(key.nonce),
      child = label(actualChildClient),
      generation = label(currentGeneration);
    return this.record(id, consume ? 'readwrite' : 'readonly', (value, table) => {
      if (
        !value ||
        value.state !== 'bound' ||
        value.nonce !== nonce ||
        value.childClient !== child ||
        value.installationGeneration !== generation
      )
        return;
      const result = content(value);
      if (consume) {
        const purged: StoredIntent = internalRecord({
          ...metadata(value),
          state: 'consumed',
        });
        table.put(purged);
        result.metadata = metadata(purged);
      }
      return result;
    });
  }

  close(
    id: string,
    authenticatedActor: DocumentIntentActor,
    parentToken: string,
  ): Promise<boolean> {
    const owner = actor(authenticatedActor),
      token = identifier(parentToken);
    return this.record(id, 'readwrite', (value, table) => {
      if (!value || !owns(value, owner) || value.parentToken !== token) return false;
      table.put(internalRecord({ ...metadata(value), state: 'closed' }));
      return true;
    });
  }

  async disconnect(): Promise<void> {
    const connection = this.connection;
    this.connection = undefined;
    if (connection) (await connection).close();
  }
}
