import 'ses';
import type { PrecacheReceipt } from '../../shared/types.ts';
import { scopeContextStorage } from './storage.ts';
import { createWorkerFactory } from './worker-factory.ts';
import { installScriptPolicy } from '../enforcement/scripts.ts';
import { preparedWorker } from '../precache-registration.ts';
import { resourceAliases } from '../resource-aliases.ts';
import { createPolicyTools } from '../enforcement/native.ts';
import { installNavigationPolicy } from '../enforcement/navigation.ts';
import { installDOMPolicy, installResourceAttributePolicy } from '../enforcement/dom.ts';
import { installEffectPolicy } from '../enforcement/effects.ts';
import { scopeWebStorage } from '../enforcement/web-storage.ts';

export interface WindowContentMetadata {
  aliases: [string, string][];
  serviceWorker: PrecacheReceipt | null;
  source: string;
  documentBase?: string;
}

interface WindowRealmOptions {
  application: string;
  applicationURL: string;
  scriptNonce: string;
}

/** Establish window policies before its adapter renders any publisher content. */
export function prepareWindowRealm({
  application,
  applicationURL,
  scriptNonce,
}: WindowRealmOptions) {
  const rawGetAttribute = Element.prototype.getAttribute;
  const NativeURL = URL;
  lockdown({
    evalTaming: 'unsafe-eval',
    errorTaming: 'safe',
    consoleTaming: 'safe',
    overrideTaming: 'severe',
  });
  const tools = createPolicyTools();
  const { method, accessor, descriptor, apply, fail, define } = tools;
  let applicationWorker: ReturnType<typeof preparedWorker> = null;
  let resourceBase = applicationURL;
  const resources = resourceAliases({
    method,
    accessor,
    descriptor,
    apply,
    baseURL: () => resourceBase,
  });
  const createWorker = createWorkerFactory(tools, {
    applicationURL,
    baseURL: () => resourceBase,
    resources,
  });
  const scripts = installScriptPolicy(tools, {
    nonce: scriptNonce,
    mapURL: resources.mapURL,
    isInstalledURL: resources.isInstalledURL,
  });
  installNavigationPolicy(tools);
  installDOMPolicy(tools, rawGetAttribute, scripts);
  installEffectPolicy(tools, () => applicationWorker, { Worker: createWorker });
  scopeContextStorage(application, tools);
  scopeWebStorage(`pf:${application}:`, tools);
  installResourceAttributePolicy(tools, resources.mapURL, scripts);

  function admitContent(data: WindowContentMetadata) {
    resources.install(data.aliases);
    resourceBase = data.documentBase || data.source;
    applicationWorker = preparedWorker(data.serviceWorker, {
      source: data.source,
      runtime: applicationURL,
      fail,
    });
    define(window, 'privacyHost', {
      value: Object.freeze({
        version: 1,
        application,
        publisher: new NativeURL(data.source).origin,
        mode: 'network-isolated',
      }),
      writable: false,
      configurable: false,
    });
  }

  return { tools, resources, admitContent };
}
