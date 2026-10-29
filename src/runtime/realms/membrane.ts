import createVirtualEnvironment from '@locker/near-membrane-dom';
import { boundaryValue, type ApplicationRealm } from './types.ts';

/** Experimental adapter: only the contract harness may load this until qualified. */
export function createMembraneRealm(): ApplicationRealm {
  const capabilities = new WeakSet<object>();
  const denied = () => {
    throw new Error('Host operation is outside the primitive capability bridge');
  };
  const environment = createVirtualEnvironment(window, {
    keepAlive: false,
    protectDistortions: true,
    globalObjectShape: Object.create(null),
    distortionCallback(value) {
      return typeof value === 'function' && !capabilities.has(value) ? denied : value;
    },
  });
  let active = true;
  return {
    backend: 'membrane',
    evaluate(source: string) {
      if (!active) throw new Error('Realm authority was revoked');
      return boundaryValue(environment.evaluate(source), (callback) =>
        capabilities.add(callback),
      );
    },
    revoke() {
      active = false;
    },
  };
}
