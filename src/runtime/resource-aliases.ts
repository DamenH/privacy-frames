import type { PolicyTools } from './enforcement/native.ts';

type AliasTools = Pick<PolicyTools, 'method' | 'accessor' | 'descriptor' | 'apply'>;

export interface ResourceAliases {
  mapURL(input: unknown): string;
  install(entries: Iterable<readonly [string, string]>): void;
}

// Translate captured publisher URLs before native request creation. CSP permits
// only the runtime origin; the worker independently checks resource ownership.
export function resourceAliases({
  method,
  accessor,
  descriptor,
  apply,
}: AliasTools): ResourceAliases {
  const NativeURL = URL;
  const NativeRequest = Request;
  const nativeFetch = fetch;
  const requestURL = descriptor(Request.prototype, 'url')?.get;
  if (!requestURL) throw new Error('Native request URL access is required');
  const readRequestURL = requestURL;

  let aliases = new Map<string, string>();

  function mapURL(input: unknown): string {
    const url = new NativeURL(String(input), document.baseURI);
    const hash = url.hash;
    url.hash = '';
    const installed = aliases.get(url.href);
    if (installed !== undefined) return installed + hash;
    url.hash = hash;
    return url.href;
  }

  function mapRequest(input: RequestInfo | URL): RequestInfo {
    return input instanceof NativeRequest
      ? new NativeRequest(mapURL(apply(readRequestURL, input, [])), input)
      : mapURL(input);
  }

  method(
    window,
    'fetch',
    function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      return apply(nativeFetch, this, [mapRequest(input), init]);
    },
  );

  const nativeOpen = XMLHttpRequest.prototype.open;
  method(
    XMLHttpRequest.prototype,
    'open',
    function (
      this: XMLHttpRequest,
      verb: string,
      url: string | URL,
      ...rest: [async?: boolean, username?: string | null, password?: string | null]
    ): void {
      apply(nativeOpen, this, [verb, mapURL(url), ...rest]);
    },
  );

  const nativePut = Cache.prototype.put;
  method(Cache.prototype, 'add', async function (this: Cache, input: RequestInfo | URL) {
    const request = new NativeRequest(input);
    const response = await nativeFetch(mapRequest(request));
    if (!response.ok || response.status === 206) {
      throw new TypeError('Cache download failed');
    }
    await apply(nativePut, this, [request, response]);
  });

  method(
    Cache.prototype,
    'addAll',
    async function (this: Cache, inputs: Iterable<RequestInfo | URL>) {
      const requests = Array.from(inputs, (input) => new NativeRequest(input));
      if (new Set(requests.map((request) => request.url)).size !== requests.length) {
        throw new TypeError('Duplicate cache requests');
      }
      const responses = await Promise.all(
        requests.map((request) => nativeFetch(mapRequest(request))),
      );
      if (responses.some((response) => !response.ok || response.status === 206)) {
        throw new TypeError('Cache download failed');
      }
      for (let index = 0; index < requests.length; index++) {
        await apply(nativePut, this, [requests[index], responses[index]]);
      }
    },
  );

  const urlProperties: readonly [{ prototype: HTMLElement } | undefined, string][] = [
    [globalThis.HTMLImageElement, 'src'],
    [globalThis.HTMLMediaElement, 'src'],
    [globalThis.HTMLSourceElement, 'src'],
    [globalThis.HTMLInputElement, 'src'],
    [globalThis.HTMLVideoElement, 'poster'],
    [globalThis.HTMLAnchorElement, 'href'],
    [globalThis.HTMLAreaElement, 'href'],
  ];
  for (const [constructor, key] of urlProperties) {
    if (!constructor) continue;
    const original = descriptor(constructor.prototype, key);
    const nativeSet = original?.set;
    if (!nativeSet) continue;
    accessor(constructor.prototype, key, {
      set(this: HTMLElement, value: unknown) {
        return apply(nativeSet, this, [mapURL(value)]);
      },
    });
  }

  return Object.freeze({
    mapURL,
    install(entries: Iterable<readonly [string, string]>) {
      aliases = new Map(entries);
    },
  });
}
