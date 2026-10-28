import {
  strings,
  internalArray,
  internalData,
  internalRecord,
} from '../../shared/primordials.ts';
import type { PolicyTools } from '../enforcement/native.ts';
type IndexedDBTools = Pick<
  PolicyTools,
  'method' | 'accessor' | 'descriptor' | 'apply' | 'fail'
> & {
  prefix: string;
};
// Rewrite factory methods so recovering a native prototype cannot bypass the
// namespace. Requests and transactions retain their native event behavior.
export function scopeIndexedDB({
  prefix,
  method,
  accessor,
  descriptor,
  apply,
  fail,
}: IndexedDBTools): IDBFactory {
  const nativeOpen = IDBFactory.prototype.open;
  const nativeDelete = IDBFactory.prototype.deleteDatabase;
  const nativeList = IDBFactory.prototype.databases;
  const nativeName = descriptor(IDBDatabase.prototype, 'name')?.get;
  if (!nativeName) throw new Error('Native database name access is required');
  const factory = indexedDB;
  method(
    IDBFactory.prototype,
    'open',
    function (this: IDBFactory, name?: unknown, ...version: [number?]): IDBOpenDBRequest {
      if (!arguments.length) throw new TypeError('Database name is required');
      return apply(nativeOpen, this, [prefix + String(name), ...version]);
    },
  );
  method(
    IDBFactory.prototype,
    'deleteDatabase',
    function (this: IDBFactory, name?: unknown): IDBOpenDBRequest {
      if (!arguments.length) throw new TypeError('Database name is required');
      return apply(nativeDelete, this, [prefix + String(name)]);
    },
  );
  if (nativeList) {
    method(IDBFactory.prototype, 'databases', async function (this: IDBFactory): Promise<
      IDBDatabaseInfo[]
    > {
      const databases = internalArray<IDBDatabaseInfo>(
        internalData(await apply(nativeList, this, [])),
      );
      return databases
        .filter(
          (
            database,
          ): database is IDBDatabaseInfo & {
            name: string;
          } =>
            typeof database.name === 'string' &&
            strings.startsWith(database.name, prefix),
        )
        .map((database) =>
          internalRecord({
            ...database,
            name: strings.slice(database.name, prefix.length),
          }),
        );
    });
  }
  accessor(
    IDBDatabase.prototype,
    'name',
    internalRecord({
      get(this: IDBDatabase): string {
        const name: string = apply(nativeName, this, []);
        if (!strings.startsWith(name, prefix))
          fail('Database belongs to another application');
        return strings.slice(name, prefix.length);
      },
    }),
  );
  return factory;
}
