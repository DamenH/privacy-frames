import { internalRecord } from '../../shared/primordials.ts';
import { isApplicationRoute } from '../../shared/application-navigation.ts';

export const CONTEXT_POLICY_VERSION = 2;

export type ContextKind = 'window' | 'dedicated-worker' | 'shared-worker' | 'worklet';
export type ContextState = 'preparing' | 'ready' | 'running' | 'closed';

export interface ContextIdentity {
  policyVersion: number;
  installationGeneration: string;
  id: string;
  application: string;
  parent: string | null;
  kind: ContextKind;
  state: ContextState;
  url: string;
}

export interface WorkerBootstrapMetadata {
  identity: ContextIdentity;
  runtime: string;
  applicationURL: string;
  aliases: [string, string][];
  rootAliases: [string, string][];
}

export interface ContextStorage {
  get(client: string): Promise<ContextIdentity | undefined>;
  put(client: string, identity: ContextIdentity): Promise<void>;
  lookupByContext(context: string): Promise<string | undefined>;
  isClosureRequested(
    parent: string,
    application: string,
    context: string,
  ): Promise<boolean>;
  requestClosure(parent: string, application: string, context: string): Promise<void>;
}

/** Only the browser-facing controller creates identity bindings. */
export class ContextRegistry {
  private readonly storage: ContextStorage;
  private mutations: Promise<void> = Promise.resolve();

  constructor(storage: ContextStorage) {
    this.storage = storage;
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutations.then(operation);
    this.mutations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  bind(client: string, identity: ContextIdentity): Promise<void> {
    return this.mutate(async () => {
      if (
        !client ||
        !identity.id ||
        !identity.application ||
        !identity.url ||
        !identity.installationGeneration ||
        identity.policyVersion !== CONTEXT_POLICY_VERSION
      )
        throw new Error('Incomplete browser context identity');
      if (await this.storage.get(client)) throw new Error('Browser client already bound');
      if (await this.storage.lookupByContext(identity.id))
        throw new Error('Context identifier already bound');
      if (
        identity.parent &&
        (await this.storage.isClosureRequested(
          identity.parent,
          identity.application,
          identity.id,
        ))
      )
        throw new Error('Browser context closed before startup');
      await this.storage.put(client, internalRecord({ ...identity, state: 'preparing' }));
    });
  }

  async resolve(client: {
    id: string;
    url: string;
  }): Promise<ContextIdentity | undefined> {
    const identity = await this.storage.get(client.id);
    if (identity?.policyVersion !== CONTEXT_POLICY_VERSION || identity.state === 'closed')
      return;
    let address = client.url;
    if (identity.kind === 'window') {
      if (identity.parent === null)
        return isApplicationRoute(address, identity.url) ? identity : undefined;
      try {
        const url = new URL(address);
        url.hash = '';
        address = url.href;
      } catch {
        return;
      }
    }
    return identity.url === address ? identity : undefined;
  }

  async resolveWorker(client: string): Promise<ContextIdentity | undefined> {
    const identity = await this.storage.get(client);
    return identity?.policyVersion === CONTEXT_POLICY_VERSION &&
      identity.state !== 'closed' &&
      (identity.kind === 'dedicated-worker' || identity.kind === 'shared-worker')
      ? identity
      : undefined;
  }

  /** A bearer grants immutable graph reads only; it never supplies browser identity. */
  async resourceCapability(
    context: string,
    caller: string,
  ): Promise<{ client: string; identity: ContextIdentity } | undefined> {
    const client = await this.storage.lookupByContext(context);
    if (!client || (caller && caller !== client)) return undefined;
    const identity = await this.resolveWorker(client);
    return identity?.id === context ? internalRecord({ client, identity }) : undefined;
  }

  /** Synchronization is idempotent bookkeeping, not evidence of trusted execution. */
  markResourceReady(context: string, caller: string): Promise<boolean> {
    return this.mutate(async () => {
      const capability = await this.resourceCapability(context, caller);
      if (!capability) return false;
      if (capability.identity.state === 'preparing')
        await this.storage.put(
          capability.client,
          internalRecord({
            ...capability.identity,
            state: 'ready',
          }),
        );
      const current = await this.resourceCapability(context, caller);
      if (!current) return false;
      if (current.identity.state === 'ready')
        await this.storage.put(
          current.client,
          internalRecord({
            ...current.identity,
            state: 'running',
          }),
        );
      return !!(await this.resourceCapability(context, caller));
    });
  }

  transition(client: { id: string; url: string }, state: ContextState): Promise<void> {
    return this.mutate(async () => {
      const identity = await this.resolve(client);
      if (!identity) throw new Error('Browser context is not bound');
      const allowed: Record<ContextState, ContextState[]> = internalRecord({
        preparing: ['ready', 'closed'],
        ready: ['running', 'closed'],
        running: ['closed'],
        closed: [],
      });
      if (!allowed[identity.state].includes(state))
        throw new Error('Invalid browser context transition');
      await this.storage.put(client.id, internalRecord({ ...identity, state }));
    });
  }

  closeChild(parent: string, application: string, context: string): Promise<boolean> {
    return this.mutate(async () => {
      if (!parent || !application || !context) return false;
      const client = await this.storage.lookupByContext(context);
      if (client) {
        const identity = await this.storage.get(client);
        if (
          !identity ||
          identity.policyVersion !== CONTEXT_POLICY_VERSION ||
          identity.id !== context ||
          identity.application !== application ||
          identity.parent !== parent
        )
          return false;
        await this.storage.requestClosure(parent, application, context);
        await this.storage.put(client, internalRecord({ ...identity, state: 'closed' }));
        return true;
      }
      // A constructor can be terminated before its reserved client is bound.
      // This owner-scoped request also rejects a later bind after controller restart.
      await this.storage.requestClosure(parent, application, context);
      const racedClient = await this.storage.lookupByContext(context);
      if (racedClient) {
        const identity = await this.storage.get(racedClient);
        if (
          !identity ||
          identity.policyVersion !== CONTEXT_POLICY_VERSION ||
          identity.id !== context ||
          identity.application !== application ||
          identity.parent !== parent
        )
          return false;
        await this.storage.put(
          racedClient,
          internalRecord({ ...identity, state: 'closed' }),
        );
      }
      return true;
    });
  }
}
