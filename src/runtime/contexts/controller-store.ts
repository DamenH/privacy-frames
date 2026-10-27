import { CONTEXT_POLICY_VERSION } from './model.ts';
import type {
  ContextIdentity,
  ContextKind,
  ContextState,
  ContextStorage,
} from './model.ts';

function kind(value: unknown): value is ContextKind {
  return (
    value === 'window' ||
    value === 'dedicated-worker' ||
    value === 'shared-worker' ||
    value === 'worklet'
  );
}
function state(value: unknown): value is ContextState {
  return (
    value === 'preparing' ||
    value === 'ready' ||
    value === 'running' ||
    value === 'closed'
  );
}
function parse(value: unknown): ContextIdentity {
  if (
    !value ||
    typeof value !== 'object' ||
    !('policyVersion' in value) ||
    value.policyVersion !== CONTEXT_POLICY_VERSION ||
    !('installationGeneration' in value) ||
    typeof value.installationGeneration !== 'string' ||
    !value.installationGeneration ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !('application' in value) ||
    typeof value.application !== 'string' ||
    !('parent' in value) ||
    !(value.parent === null || typeof value.parent === 'string') ||
    !('kind' in value) ||
    !kind(value.kind) ||
    !('state' in value) ||
    !state(value.state) ||
    !('url' in value) ||
    typeof value.url !== 'string'
  )
    throw new Error('Invalid stored context identity');
  return {
    policyVersion: value.policyVersion,
    installationGeneration: value.installationGeneration,
    id: value.id,
    application: value.application,
    parent: value.parent,
    kind: value.kind,
    state: value.state,
    url: value.url,
  };
}

/** This store exists only in the trusted controller, outside app cache namespaces. */
export function controllerContextStorage(base: URL): ContextStorage {
  const key = (client: string) =>
    new URL('__host-context/' + encodeURIComponent(client), base).href;
  const contextKey = (context: string) =>
    new URL('__host-context-index/' + encodeURIComponent(context), base).href;
  const closedKey = (client: string) =>
    new URL('__host-context-closed/' + encodeURIComponent(client), base).href;
  const closureKey = (parent: string, application: string, context: string) =>
    new URL(
      '__host-context-close/' +
        [parent, application, context].map(encodeURIComponent).join('/'),
      base,
    ).href;
  const open = () => caches.open('pf-browser-contexts-v1');
  return {
    async get(client) {
      const cache = await open();
      const response = await cache.match(key(client));
      if (!response) return undefined;
      const identity = parse(await response.json());
      const closed = await cache.match(closedKey(client));
      const requested = identity.parent
        ? await cache.match(
            closureKey(identity.parent, identity.application, identity.id),
          )
        : undefined;
      return closed || requested ? { ...identity, state: 'closed' } : identity;
    },
    async put(client, identity) {
      const cache = await open();
      if (identity.state === 'closed')
        await cache.put(closedKey(client), new Response('closed'));
      await cache.put(
        key(client),
        new Response(JSON.stringify(identity), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await cache.put(contextKey(identity.id), new Response(client));
    },
    async lookupByContext(context) {
      const result = await (await open()).match(contextKey(context));
      if (!result) return undefined;
      const client = await result.text();
      if (!client) throw new Error('Invalid context client index');
      return client;
    },
    async isClosureRequested(parent, application, context) {
      return !!(await (await open()).match(closureKey(parent, application, context)));
    },
    async requestClosure(parent, application, context) {
      await (
        await open()
      ).put(closureKey(parent, application, context), new Response('closed'));
    },
  };
}
