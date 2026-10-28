import { bindingProbe, cacheCallbackProbe } from './probe.ts';
(async () =>
  self.postMessage({ bindings: bindingProbe(), cache: await cacheCallbackProbe() }))();
