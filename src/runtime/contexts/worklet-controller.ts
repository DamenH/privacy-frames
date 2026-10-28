import {
  strings,
  internalArray,
  ownDescriptor,
  internalRecord,
} from '../../shared/primordials.ts';
import { LIMITS, isExecutableScriptType, mime } from '../../shared/policy.ts';
import { applicationURL, resourceURL } from '../../shared/runtime-url.ts';
import type { StoredInstallation } from '../storage.ts';
import { response } from '../response-policy.ts';
import { readDocumentRequest } from './document-request.ts';
import {
  WorkletRegistry,
  workletIdentifier,
  workletKind,
  workletModuleSource,
  workletStorage,
  type WorkletActor,
  type WorkletStorage,
  type StoredWorklet,
} from './worklet-store.ts';
import type { WorkletModuleSource, WorkletRegistration } from './worklet-types.ts';
import { prepareWorkletModule } from './worklet-source.ts';
export interface WorkletOwner {
  app: StoredInstallation;
  clientId: string;
}
interface WorkletControllerOptions {
  base: URL;
  /** Resolve an actual browser Window client, never an identity supplied in JSON. */
  owner(clientId: string): Promise<WorkletOwner | undefined>;
  readResource(
    app: StoredInstallation,
    path: string,
    generation: string,
  ): Promise<ArrayBuffer>;
  guardSource(): Promise<string>;
  storage?: WorkletStorage;
}
function field(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid worklet request');
  const property = ownDescriptor(value, key);
  if (property && !('value' in property))
    throw new Error('Invalid worklet request field');
  return property?.value;
}
function javascript(contentType: string): boolean {
  const essence = strings.toLowerCase(strings.trim(strings.split(contentType, ';')[0]));
  return strings.includes(essence, '/') && isExecutableScriptType(essence);
}
function actor(owner: WorkletOwner): WorkletActor {
  return internalRecord({
    application: owner.app.id,
    generation: owner.app.generation,
    parentClient: owner.clientId,
  });
}
function resource(app: StoredInstallation, input: string, base: URL) {
  const url = new URL(input);
  url.hash = '';
  return app.resources.find(
    (item) =>
      item.url === url.href || resourceURL(app, item.path, base).href === url.href,
  );
}
function directory(identity: StoredWorklet, app: StoredInstallation, base: URL) {
  return new URL(`__contexts/${identity.id}/worklet/`, applicationURL(app, base));
}
/** Worklet module requests retain the owning Window's client ID in both engines. */
export function createWorkletController(options: WorkletControllerOptions) {
  const registry = new WorkletRegistry(options.storage || workletStorage(options.base));
  async function respond(
    event: Pick<FetchEvent, 'request' | 'clientId' | 'resultingClientId'>,
  ): Promise<Response | undefined> {
    const request = event.request,
      url = new URL(request.url);
    if (url.origin !== options.base.origin) return undefined;
    const context = strings.match(
      url.pathname,
      /\/__contexts\/([a-f0-9-]{36})\/worklet\/(.*)$/,
    );
    const issuing = !context && strings.endsWith(url.pathname, '/__worklet-intents');
    if (!context && !issuing) return undefined;
    try {
      if (!event.clientId || event.resultingClientId) return Response.error();
      const owner = await options.owner(event.clientId);
      if (!owner || owner.clientId !== event.clientId) return Response.error();
      const appURL = applicationURL(owner.app, options.base);
      if (issuing) {
        if (
          url.href !== new URL('__worklet-intents', appURL).href ||
          request.method !== 'POST' ||
          request.destination !== '' ||
          request.mode === 'navigate'
        )
          return Response.error();
        const value: unknown = await readDocumentRequest(request);
        const kind = workletKind(field(value, 'kind'));
        let source: WorkletModuleSource = workletModuleSource(field(value, 'source'));
        if (source.kind === 'resource') {
          const item = resource(owner.app, source.url, options.base);
          if (!item || !javascript(item.contentType || mime(item.path)))
            throw new Error('Worklet entry is not installed JavaScript');
          const fragment = new URL(source.url).hash;
          source = internalRecord({ kind: 'resource', url: item.url + fragment });
        } else if (new URL(source.url).origin !== options.base.origin)
          throw new Error('Worklet Blob belongs to another origin');
        const existing = field(value, 'id');
        const issued = await registry.register(
          actor(owner),
          kind,
          source,
          existing === undefined ? undefined : workletIdentifier(existing),
        );
        const registration: WorkletRegistration = internalRecord({
          id: issued.identity.id,
          kind,
          url: new URL(
            `entry/${issued.entry.id}.js`,
            directory(issued.identity, owner.app, options.base),
          ).href,
        });
        return response(JSON.stringify(registration), 'application/json');
      }
      if (!context || request.method !== 'GET' || request.mode === 'navigate')
        return Response.error();
      const identity = await registry.resolve(context[1], actor(owner));
      if (
        !identity ||
        request.destination !==
          (identity.kind === 'audio' ? 'audioworklet' : 'paintworklet')
      )
        return Response.error();
      const root = directory(identity, owner.app, options.base);
      if (url.href !== new URL(context[2], root).href) return Response.error();
      const guardURL = new URL('guard.js', root).href;
      if (context[2] === 'guard.js') {
        const { entries: _entries, state: _state, ...metadata } = identity;
        return response(
          'const __privacyWorkletMetadata=' +
            JSON.stringify(metadata) +
            ';\n' +
            (await options.guardSource()),
          'text/javascript',
        );
      }
      const aliases = internalArray<[string, string]>();
      for (const item of owner.app.resources) {
        const target = new URL('resources/' + item.path, root).href;
        aliases.push(
          [item.url, target],
          [resourceURL(owner.app, item.path, options.base).href, target],
          [target, target],
        );
      }
      const entry = strings.match(context[2], /^entry\/([a-f0-9-]{36})\.js$/);
      let code: string, baseURL: string, logicalURL: string;
      if (entry) {
        const module = identity.entries.find((item) => item.id === entry[1]);
        if (!module) return Response.error();
        if (module.source.kind === 'resource') {
          const item = resource(owner.app, module.source.url, options.base);
          if (!item || !javascript(item.contentType || mime(item.path)))
            return Response.error();
          const target =
            new URL('resources/' + item.path, root).href +
            new URL(module.source.url).hash;
          return response(
            'import ' +
              JSON.stringify(guardURL) +
              ';\nimport ' +
              JSON.stringify(target) +
              ';',
            'text/javascript',
          );
        }
        code = module.source.text;
        baseURL = logicalURL = module.source.url;
      } else {
        const item = owner.app.resources.find(
          (item) => url.href === new URL('resources/' + item.path, root).href,
        );
        if (!item || !javascript(item.contentType || mime(item.path)))
          return Response.error();
        const bytes = await options.readResource(
          owner.app,
          item.path,
          identity.generation,
        );
        if (bytes.byteLength > LIMITS.bytes) return Response.error();
        code = new TextDecoder().decode(bytes);
        baseURL = resourceURL(owner.app, item.path, options.base).href;
        logicalURL = item.url;
      }
      return response(
        prepareWorkletModule(
          code,
          internalRecord({ baseURL, logicalURL, guardURL, aliases }),
        ),
        'text/javascript',
      );
    } catch {
      return Response.error();
    }
  }
  return internalRecord({ respond });
}
