import { bindingProbe, cacheCallbackProbe, webStorageCallbackProbe } from './probe.ts';
window.runGlobalBindingProbe = async () => ({
  bindings: bindingProbe(),
  webStorage: webStorageCallbackProbe(),
  cache: await cacheCallbackProbe(),
});
