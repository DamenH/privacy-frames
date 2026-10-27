import type { PrecacheReceipt } from '../shared/types.ts';

interface PrecacheWorker extends EventTarget {
  readonly state: 'activated';
  readonly scriptURL: string;
  postMessage(): never;
}

interface PrecacheRegistration extends EventTarget {
  readonly scope: string;
  readonly active: PrecacheWorker;
  readonly installing: null;
  readonly waiting: null;
  readonly navigationPreload: Readonly<{
    getState(): Promise<{ enabled: false; headerValue: string }>;
    enable(): Promise<never>;
    disable(): Promise<never>;
    setHeaderValue(): Promise<never>;
  }>;
  update(): Promise<never>;
  unregister(): Promise<never>;
}

export interface PrecacheContainer extends EventTarget {
  readonly controller: PrecacheWorker | null;
  readonly ready: Promise<PrecacheRegistration>;
  register(
    input: string | URL,
    options?: RegistrationOptions,
  ): Promise<PrecacheRegistration>;
  getRegistration(input?: string | URL): Promise<PrecacheRegistration | undefined>;
  getRegistrations(): Promise<PrecacheRegistration[]>;
  startMessages(): void;
}

interface PrecacheContext {
  source: string;
  runtime: string;
  fail(message: string): never;
}

// This interface reports completed precaching. Publisher fetch handlers never
// become native controllers of the isolated document.
export function preparedWorker(
  receipt: PrecacheReceipt | null | undefined,
  { source, runtime, fail }: PrecacheContext,
): PrecacheContainer | null {
  if (
    !receipt ||
    receipt.profile !== 'precache-v1' ||
    !receipt.completed?.includes('install') ||
    !receipt.completed?.includes('activate')
  ) {
    const unsupported = () =>
      Promise.reject(
        new DOMException(
          'Publisher worker preparation is unavailable',
          'NotSupportedError',
        ),
      );
    class UnpreparedContainer extends EventTarget implements PrecacheContainer {
      readonly controller = null;
      get ready(): Promise<PrecacheRegistration> {
        return unsupported();
      }
      register(): Promise<PrecacheRegistration> {
        return unsupported();
      }
      async getRegistration(): Promise<undefined> {
        return undefined;
      }
      async getRegistrations(): Promise<PrecacheRegistration[]> {
        return [];
      }
      startMessages() {}
    }
    Object.freeze(UnpreparedContainer.prototype);
    return Object.freeze(new UnpreparedContainer());
  }

  const original = new URL(receipt.scriptURL);
  const publisher = new URL(source);
  const origin = new URL(runtime).origin;
  const virtual = new URL('sw.js', new URL('./', runtime));
  const virtualScope = new URL('./', virtual);
  const preparedScope = new URL(receipt.scope);

  function unsupported(): Promise<never> {
    return Promise.reject(
      new DOMException(
        'Application worker operation is not supported by this host',
        'NotSupportedError',
      ),
    );
  }

  function admitted(input: string | URL): boolean {
    const url = new URL(String(input), document.baseURI);
    return (
      url.href === original.href ||
      url.href === virtual.href ||
      (url.origin === origin &&
        url.pathname === original.pathname &&
        url.search === original.search)
    );
  }

  const active: PrecacheWorker = Object.freeze(
    Object.assign(new EventTarget(), {
      state: 'activated' as const,
      scriptURL: virtual.href,
      postMessage(): never {
        return fail('Publisher worker messaging is not available');
      },
    }),
  );

  const registration: PrecacheRegistration = Object.freeze(
    Object.assign(new EventTarget(), {
      scope: virtualScope.href,
      active,
      installing: null,
      waiting: null,
      update: unsupported,
      unregister: unsupported,
      navigationPreload: Object.freeze({
        async getState() {
          return { enabled: false as const, headerValue: 'true' };
        },
        enable: unsupported,
        disable: unsupported,
        setHeaderValue: unsupported,
      }),
    }),
  );

  return Object.freeze(
    Object.assign(new EventTarget(), {
      controller: active,
      ready: Promise.resolve(registration),
      async register(input: string | URL, options: RegistrationOptions = {}) {
        if (!admitted(input)) fail('Only the prepared application worker is available');
        if (options.scope !== undefined) {
          const scope = new URL(options.scope, document.baseURI);
          if (
            ![origin, publisher.origin].includes(scope.origin) ||
            ![preparedScope.pathname, virtualScope.pathname].includes(scope.pathname)
          ) {
            fail('Worker scope differs from prepared scope');
          }
        }
        return registration;
      },
      async getRegistration(input?: string | URL) {
        if (input !== undefined) {
          const url = new URL(input, document.baseURI);
          const hasScope = [preparedScope.pathname, virtualScope.pathname].some((path) =>
            url.pathname.startsWith(path),
          );
          if (![origin, publisher.origin].includes(url.origin) || !hasScope) return;
        }
        return registration;
      },
      async getRegistrations() {
        return [registration];
      },
      startMessages() {},
    }),
  );
}
