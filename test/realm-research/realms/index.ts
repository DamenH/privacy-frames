import { createNativeRealm } from './native.ts';
import { createMembraneRealm } from './membrane.ts';
import type { ApplicationRealm, RealmBackend } from './types.ts';

export function createApplicationRealm(backend: RealmBackend): ApplicationRealm {
  return backend === 'native' ? createNativeRealm() : createMembraneRealm();
}
