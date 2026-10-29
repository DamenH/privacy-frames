import { boundaryValue, type ApplicationRealm } from './types.ts';

/** Native constructor presence is checked outside application execution. */
export function createNativeRealm(): ApplicationRealm {
  const Constructor: unknown = Reflect.get(globalThis, 'ShadowRealm');
  if (typeof Constructor !== 'function')
    throw new Error('Native ShadowRealm is unavailable');
  const realm: unknown = Reflect.construct(Constructor, []);
  if (!realm || typeof realm !== 'object') throw new Error('Invalid native realm');
  const evaluate: unknown = Reflect.get(realm, 'evaluate');
  if (typeof evaluate !== 'function') throw new Error('Native evaluator unavailable');
  let active = true;
  return {
    backend: 'native',
    evaluate(source: string) {
      if (!active) throw new Error('Realm authority was revoked');
      return boundaryValue(Reflect.apply(evaluate, realm, [source]));
    },
    revoke() {
      active = false;
    },
  };
}
