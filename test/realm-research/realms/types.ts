export type RealmPrimitive =
  undefined | null | boolean | number | string | bigint | symbol;
export type RealmValue = RealmPrimitive | RealmCallable;
export type RealmCallable = (...arguments_: RealmValue[]) => RealmValue;
export type RealmBackend = 'native' | 'membrane';

export interface ApplicationRealm {
  readonly backend: RealmBackend;
  evaluate(source: string): RealmValue;
  revoke(): void;
}

export function boundaryValue(
  value: unknown,
  grant: (callback: RealmCallable) => void = () => {},
): RealmValue {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string' ||
    typeof value === 'bigint' ||
    typeof value === 'symbol'
  )
    return value;
  if (typeof value !== 'function')
    throw new TypeError('Realm boundary accepts primitives and callable functions only');
  const callable = (...arguments_: RealmValue[]) => {
    for (const argument of arguments_)
      if (argument !== null && typeof argument === 'object')
        throw new TypeError('Object argument cannot cross the realm boundary');
    return boundaryValue(
      Reflect.apply(
        value,
        undefined,
        arguments_.map((argument) => boundaryValue(argument, grant)),
      ),
      grant,
    );
  };
  grant(callable);
  return callable;
}
