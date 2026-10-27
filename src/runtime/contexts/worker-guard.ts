import 'ses';
import {
  CONTEXT_POLICY_VERSION,
  type ContextIdentity,
  type WorkerBootstrapMetadata,
} from './model.ts';
import { createPolicyTools } from '../enforcement/native.ts';
import { installEffectPolicy } from '../enforcement/effects.ts';
import { resourceAliases } from '../resource-aliases.ts';
import { scopeContextStorage } from './storage.ts';
import { relocateRuntimeModule } from '../modules.ts';
import { createWorkerFactory } from './worker-factory.ts';

const worker = self as unknown as DedicatedWorkerGlobalScope;
const rawAdd = EventTarget.prototype.addEventListener;
const rawStop = Event.prototype.stopImmediatePropagation;
const rawImport = worker.importScripts;
const rawMessageData = Object.getOwnPropertyDescriptor(
  MessageEvent.prototype,
  'data',
)!.get!;
const rawMessagePorts = Object.getOwnPropertyDescriptor(
  MessageEvent.prototype,
  'ports',
)!.get!;
const rawPortPost = MessagePort.prototype.postMessage;
const rawPortStart = MessagePort.prototype.start;
const rawPortClose = MessagePort.prototype.close;
const rawCreateURL = URL.createObjectURL;
const rawRevokeURL = URL.revokeObjectURL;
const NativeBlob = Blob;
const rawFetch = fetch;
const responseOK = Object.getOwnPropertyDescriptor(Response.prototype, 'ok')!.get!;

function metadata(value: unknown): WorkerBootstrapMetadata {
  if (
    !value ||
    typeof value !== 'object' ||
    !('identity' in value) ||
    !('runtime' in value) ||
    !('applicationURL' in value) ||
    !('aliases' in value)
  )
    throw new Error('Context metadata is missing');
  const identity = value.identity;
  if (
    !identity ||
    typeof identity !== 'object' ||
    !('policyVersion' in identity) ||
    identity.policyVersion !== CONTEXT_POLICY_VERSION ||
    !('installationGeneration' in identity) ||
    typeof identity.installationGeneration !== 'string' ||
    !identity.installationGeneration ||
    !('id' in identity) ||
    typeof identity.id !== 'string' ||
    !('application' in identity) ||
    typeof identity.application !== 'string' ||
    !('parent' in identity) ||
    typeof identity.parent !== 'string' ||
    !('kind' in identity) ||
    identity.kind !== 'dedicated-worker' ||
    !('state' in identity) ||
    identity.state !== 'preparing' ||
    !('url' in identity) ||
    identity.url !== location.href
  )
    throw new Error('Invalid worker identity');
  if (
    typeof value.runtime !== 'string' ||
    typeof value.applicationURL !== 'string' ||
    !Array.isArray(value.aliases)
  )
    throw new Error('Invalid context resources');
  const runtime = new URL(value.runtime);
  const application = new URL(value.applicationURL);
  if (application.origin !== runtime.origin)
    throw new Error('Invalid application origin');
  const aliases: [string, string][] = [];
  for (const pair of value.aliases) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      typeof pair[0] !== 'string' ||
      typeof pair[1] !== 'string'
    )
      throw new Error('Invalid resource alias');
    const target = new URL(pair[1]);
    if (
      target.origin !== application.origin ||
      !target.pathname.startsWith(application.pathname)
    )
      throw new Error('Resource belongs to another application');
    aliases.push([pair[0], pair[1]]);
  }
  const checked: ContextIdentity = {
    policyVersion: CONTEXT_POLICY_VERSION,
    installationGeneration: identity.installationGeneration,
    id: identity.id,
    application: identity.application,
    parent: identity.parent,
    kind: 'dedicated-worker',
    state: 'preparing',
    url: identity.url,
  };
  return {
    identity: checked,
    runtime: runtime.href,
    applicationURL: application.href,
    aliases,
  };
}

const rawMetadata: unknown = Reflect.get(globalThis, '__privacyContext');
Reflect.deleteProperty(globalThis, '__privacyContext');
const context = metadata(rawMetadata);
lockdown({
  evalTaming: 'unsafe-eval',
  errorTaming: 'safe',
  consoleTaming: 'safe',
  overrideTaming: 'severe',
});
const tools = createPolicyTools();
const { apply, method, accessor, descriptor, propertyOwner, fail } = tools;
let scriptBase = context.applicationURL;
const resources = resourceAliases({
  method,
  accessor,
  descriptor,
  apply,
  target: worker,
  baseURL: () => scriptBase,
});
resources.install(context.aliases);
const factory = createWorkerFactory(tools, {
  applicationURL: context.applicationURL,
  baseURL: () => scriptBase,
  resources,
});
installEffectPolicy(tools, () => null, { Worker: factory }, worker);
scopeContextStorage(context.identity.application, tools, worker);
const NativeURL = URL;
const readProtocol = descriptor(NativeURL.prototype, 'protocol')!.get!;
const readOrigin = descriptor(NativeURL.prototype, 'origin')!.get!;
const readHref = descriptor(NativeURL.prototype, 'href')!.get!;
const runtimeOrigin: string = apply(readOrigin, new NativeURL(context.runtime), []);
const readyURL: string = apply(
  readHref,
  new NativeURL('ready', context.identity.url),
  [],
);
const locationValues = new Map<string, string>();
const locationGetters = new Map<string, Function>();
for (const name of [
  'href',
  'origin',
  'protocol',
  'host',
  'hostname',
  'port',
  'pathname',
  'search',
  'hash',
]) {
  const get = descriptor(NativeURL.prototype, name)?.get;
  const owner = propertyOwner(location, name);
  if (get && owner) {
    locationGetters.set(name, get);
    accessor(owner, name, { get: () => locationValues.get(name) ?? '' });
  }
}
const locationStringOwner = propertyOwner(location, 'toString');
if (locationStringOwner) method(locationStringOwner, 'toString', () => scriptBase);
function installedScript(input: unknown): string {
  const mapped = resources.mapURL(input);
  const target = new NativeURL(mapped);
  const blob = apply(readProtocol, target, []) === 'blob:';
  if (
    blob
      ? apply(readOrigin, target, []) !== runtimeOrigin
      : !resources.isInstalledURL(mapped)
  )
    return fail('Script is not an installed resource or application Blob');
  return apply(readHref, target, []);
}
const importsOwner = propertyOwner(worker, 'importScripts');
if (importsOwner)
  method(importsOwner, 'importScripts', (...inputs: unknown[]) =>
    apply(rawImport, worker, inputs.map(installedScript)),
  );
Object.defineProperty(worker, 'privacyHost', {
  value: Object.freeze({
    version: 1,
    application: context.identity.application,
    mode: 'network-isolated',
    context: 'dedicated-worker',
  }),
  writable: false,
  configurable: false,
});

// Registration opens delivery of native parent messages. This permits a module
// to await its first message without waiting for module evaluation to finish.
let applicationListenerReady: (() => void) | undefined;
const onmessageOwner = propertyOwner(worker, 'onmessage');
if (!onmessageOwner) throw new Error('Worker message handlers are unavailable');
const onmessage = descriptor(onmessageOwner, 'onmessage');
if (!onmessage?.set || !onmessage.get)
  throw new Error('Worker message handler accessors are unavailable');
const setOnmessage = onmessage.set;
const getOnmessage = onmessage.get;
accessor(onmessageOwner, 'onmessage', {
  set(this: DedicatedWorkerGlobalScope, value: unknown) {
    apply(setOnmessage, this, [value]);
    if (this === worker && typeof apply(getOnmessage, this, []) === 'function')
      applicationListenerReady?.();
  },
});
method(
  EventTarget.prototype,
  'addEventListener',
  function (this: EventTarget, ...args: unknown[]) {
    if (args.length) args[0] = tools.str(args[0]);
    const result = apply(rawAdd, this, args);
    if (this === worker && args[0] === 'message' && args[1] != null)
      applicationListenerReady?.();
    return result;
  },
);

apply(rawAdd, worker, [
  'message',
  (event: MessageEvent<unknown>) => {
    apply(rawStop, event, []);
    const data: unknown = apply(rawMessageData, event, []);
    const ports: readonly MessagePort[] = apply(rawMessagePorts, event, []);
    if (
      !data ||
      typeof data !== 'object' ||
      !('type' in data) ||
      data.type !== 'pf-context-bootstrap' ||
      ports.length !== 1
    )
      throw new Error('Invalid context bootstrap channel');
    const port = ports[0];
    apply(rawAdd, port, [
      'message',
      async (message: MessageEvent<unknown>) => {
        let blob: string | undefined;
        let inputReady = false;
        const notifyInputReady = () => {
          if (inputReady) return;
          inputReady = true;
          apply(rawPortPost, port, [{ type: 'pf-context-ready' }]);
        };
        try {
          const start: unknown = apply(rawMessageData, message, []);
          if (
            !start ||
            typeof start !== 'object' ||
            !('type' in start) ||
            start.type !== 'pf-context-start' ||
            !('source' in start) ||
            typeof start.source !== 'string'
          )
            throw new Error('Invalid worker source');
          const source = installedScript(start.source);
          const expectedBase = resources.sourceURL(source) || source;
          if (!('base' in start) || start.base !== expectedBase)
            throw new Error('Worker execution base does not match its admitted source');
          scriptBase = expectedBase;
          const sourceLocation = new NativeURL(scriptBase);
          for (const [name, get] of locationGetters)
            locationValues.set(name, apply(get, sourceLocation, []));
          const module = new NativeURL(context.identity.url).pathname.endsWith(
            '/module.js',
          );
          let entry = source;
          if ('body' in start && start.body !== undefined) {
            if (
              !(start.body instanceof ArrayBuffer) ||
              start.body.byteLength > 100 * 1024 * 1024 ||
              !source.startsWith('blob:')
            )
              throw new Error('Invalid worker Blob body');
            const code = relocateRuntimeModule(
              new TextDecoder().decode(start.body),
              source,
              resources,
            );
            blob = apply(rawCreateURL, NativeURL, [
              new NativeBlob([code], { type: 'text/javascript' }),
            ]);
            entry = blob!;
          } else if (source.startsWith('blob:'))
            throw new Error('Worker Blob bytes are missing');
          const ready: Response = await apply(rawFetch, worker, [readyURL]);
          if (!apply(responseOK, ready, []))
            throw new Error('Worker context could not enter running state');
          applicationListenerReady = notifyInputReady;
          if (module) await import(entry);
          else apply(rawImport, worker, [entry]);
          notifyInputReady();
          apply(rawPortPost, port, [{ type: 'pf-context-started' }]);
        } catch (error) {
          apply(rawPortPost, port, [{ type: 'pf-context-failed' }]);
          console.error(
            'Worker startup failed:',
            error instanceof Error ? error.message : String(error),
          );
        } finally {
          applicationListenerReady = undefined;
          if (blob) apply(rawRevokeURL, NativeURL, [blob]);
          apply(rawPortClose, port, []);
        }
      },
      { once: true },
    ]);
    apply(rawPortStart, port, []);
  },
  { once: true },
]);
