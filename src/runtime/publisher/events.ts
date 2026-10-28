import {
  internalArray,
  strings,
  ownDescriptor,
  internalRecord,
  internalSet,
} from '../../shared/primordials.ts';

/** Application-visible foreground events never contain the host control channel. */
export interface PublisherClient {
  id: string;
  url: string;
  type: 'window';
  frameType: 'top-level' | 'nested' | 'auxiliary' | 'none';
  visibilityState: DocumentVisibilityState;
  focused: boolean;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}
export interface PublisherEventBridge {
  clients(): Promise<PublisherClient[]>;
  unregister(): Promise<boolean>;
}
export interface PublisherResponse {
  handled: boolean;
  response?: Response;
}
const defineProperties = Object.defineProperties;
const entries = Object.entries;
const fromEntries = Object.fromEntries;
const freeze = Object.freeze;
const assign = Object.assign;
const NativeString = String;
const NativeEvent = Event;
const NativeURL = URL;
const NativeHeaders = Headers;
const NativeEventTarget = EventTarget;
const NativePromise = Promise;
const NativeDOMException = DOMException;
const nativeResponseError = Response.error;
const nativeHeadersDelete = Headers.prototype.delete;
const nativeHeadersAppend = Headers.prototype.append;
const NativeRequest = Request;
const NativeResponse = Response;
const nativeDispatch = EventTarget.prototype.dispatchEvent;
const stopImmediate = Event.prototype.stopImmediatePropagation;
const apply = Reflect.apply;
const responseStatus = ownDescriptor(Response.prototype, 'status')!.get!;
const responseType = ownDescriptor(Response.prototype, 'type')!.get!;
const responseHeaders = ownDescriptor(Response.prototype, 'headers')!.get!;
const responseBody = ownDescriptor(Response.prototype, 'body')!.get!;
const responseRedirected = ownDescriptor(Response.prototype, 'redirected')!.get!;
const headersGet = Headers.prototype.get;
const headersEntries = Headers.prototype.entries;
const unsupported = () =>
  NativePromise.reject(
    new NativeDOMException(
      'Unsupported by the foreground publisher-worker profile',
      'NotSupportedError',
    ),
  );

export function createPublisherEvents(target: EventTarget, bridge: PublisherEventBridge) {
  function lifetime(type: string, fields: Record<string, unknown> = internalRecord({})) {
    let active = true;
    const promises = internalArray<Promise<unknown>>();
    const event = new NativeEvent(type);
    defineProperties(
      event,
      internalRecord({
        ...fromEntries(
          entries(fields).map(([key, value]) => [
            key,
            internalRecord({ value, enumerable: true }),
          ]),
        ),
        waitUntil: internalRecord({
          value(value: unknown) {
            if (!active)
              throw new NativeDOMException(
                'Event dispatch has finished',
                'InvalidStateError',
              );
            promises.push(NativePromise.resolve(value));
          },
        }),
      }),
    );
    return internalRecord({
      event,
      dispatch() {
        try {
          apply(nativeDispatch, target, [event]);
        } finally {
          active = false;
        }
      },
      settle: () => NativePromise.all(promises),
    });
  }
  return internalRecord({
    async lifecycle(type: 'install' | 'activate') {
      const job = lifetime(type);
      job.dispatch();
      await job.settle();
    },
    async message(
      data: unknown,
      source: PublisherClient | null,
      ports: readonly MessagePort[],
    ) {
      const job = lifetime(
        'message',
        internalRecord({
          data,
          source,
          ports,
          origin: source ? new NativeURL(source.url).origin : '',
          lastEventId: '',
        }),
      );
      job.dispatch();
      await job.settle();
    },
    async fetch(input: {
      url: string;
      headers: [string, string][];
      clientId: string;
      destination: RequestDestination;
    }): Promise<PublisherResponse> {
      const url = new NativeURL(input.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        throw new Error('Invalid publisher fetch URL');
      const headers = new NativeHeaders(input.headers);
      // Shared runtime-origin ambient credentials are never application inputs.
      for (const name of ['cookie', 'cookie2', 'authorization', 'proxy-authorization'])
        apply(nativeHeadersDelete, headers, [name]);
      const request = new NativeRequest(
        url.href,
        internalRecord<RequestInit>({
          method: 'GET',
          headers,
          credentials: 'omit',
          redirect: 'error',
        }),
      );
      defineProperties(
        request,
        internalRecord({
          destination: internalRecord({ value: input.destination, enumerable: true }),
        }),
      );
      let response: Promise<Response> | undefined;
      let active = true;
      const job = lifetime(
        'fetch',
        internalRecord({
          request,
          clientId: input.clientId,
          resultingClientId: '',
          replacesClientId: '',
          preloadResponse: NativePromise.resolve(undefined),
          respondWith(value: Response | PromiseLike<Response>) {
            if (!active || response)
              throw new NativeDOMException(
                'respondWith must be called once during dispatch',
                'InvalidStateError',
              );
            response = NativePromise.resolve(value);
            apply(stopImmediate, job.event, []);
          },
        }),
      );
      try {
        job.dispatch();
      } finally {
        active = false;
      }
      // Fetch lifetime extension does not replace the independently selected
      // response. A rejected waitUntil is not a rejected respondWith.
      void job.settle().catch(() => {});
      if (!response) return internalRecord({ handled: false });
      try {
        const value = await response;
        const status: number = apply(responseStatus, value, []);
        const type: ResponseType = apply(responseType, value, []);
        const redirected: boolean = apply(responseRedirected, value, []);
        if (
          type === 'error' ||
          type === 'opaque' ||
          type === 'opaqueredirect' ||
          redirected ||
          status < 200 ||
          status >= 300
        )
          throw new Error('Publisher response must be a successful nonredirect response');
        const original: Headers = apply(responseHeaders, value, []);
        const contentType: string = apply(headersGet, original, ['content-type']) || '';
        if (/\b(?:javascript|ecmascript|html|svg\+xml|xml)\b/i.test(contentType))
          throw new Error(
            'Publisher responses cannot create executable documents or scripts',
          );
        const safe = new NativeHeaders();
        // Allowlisted representation metadata excludes cookies, CORS grants,
        // redirects, refresh, authentication, and policy replacement headers.
        const allowed = internalSet([
          'content-type',
          'content-language',
          'content-encoding',
          'cache-control',
          'expires',
          'last-modified',
          'etag',
          'vary',
        ]);
        for (const [name, value] of apply(headersEntries, original, []) as Iterable<
          [string, string]
        >) {
          if (allowed.has(strings.toLowerCase(name)))
            apply(nativeHeadersAppend, safe, [name, value]);
        }
        const body: ReadableStream<Uint8Array> | null = apply(responseBody, value, []);
        return internalRecord({
          handled: true,
          response: new NativeResponse(body, internalRecord({ status, headers: safe })),
        });
      } catch {
        // A registered handler failure never falls through to a network or graph
        // response, which could hide broken application policy.
        return internalRecord({
          handled: true,
          response: apply(nativeResponseError, NativeResponse, []),
        });
      }
    },
    globals(scriptURL: string, scope: string) {
      const clients = freeze(
        internalRecord({
          async matchAll(options: ClientQueryOptions = internalRecord({})) {
            if (options.type && options.type !== 'window' && options.type !== 'all')
              return [];
            return bridge.clients();
          },
          async get(id: string) {
            return (await bridge.clients()).find(
              (client) => client.id === NativeString(id),
            );
          },
          claim: async () => undefined,
          openWindow: unsupported,
        }),
      );
      const registration = freeze(
        assign(
          new NativeEventTarget(),
          internalRecord({
            scope,
            active: freeze(internalRecord({ scriptURL, state: 'activated' })),
            installing: null,
            waiting: null,
            unregister: () => bridge.unregister(),
            update: unsupported,
            navigationPreload: freeze(
              internalRecord({
                getState: async () =>
                  internalRecord({ enabled: false, headerValue: 'true' }),
                enable: unsupported,
                disable: unsupported,
                setHeaderValue: unsupported,
              }),
            ),
          }),
        ),
      );
      return internalRecord({
        clients,
        registration,
        skipWaiting: async () => undefined,
      });
    },
  });
}
