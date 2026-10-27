import type { PolicyTools } from './enforcement/native.ts';

type AliasTools = Pick<PolicyTools, 'method' | 'accessor' | 'descriptor' | 'apply'> & {
  target?: object;
  baseURL?: () => string;
};

export interface ResourceAliases {
  mapURL(input: unknown): string;
  isInstalledURL(input: unknown): boolean;
  sourceURL(input: unknown): string | undefined;
  install(entries: Iterable<readonly [string, string]>): void;
}

// Translate captured publisher URLs before native request creation. CSP permits
// only the runtime origin; the worker independently checks resource ownership.
export function resourceAliases({
  method,
  accessor,
  descriptor,
  apply,
  target = globalThis,
  baseURL,
}: AliasTools): ResourceAliases {
  const NativeURL = URL;
  const NativeRequest = Request;
  const nativeFetch = fetch;
  const nativeDocument = typeof document === 'object' ? document : null;
  const nativeBase =
    typeof Node === 'function' ? descriptor(Node.prototype, 'baseURI')?.get : undefined;
  const fallbackBase = location.href;
  const getBase =
    baseURL ||
    (() =>
      nativeDocument && nativeBase
        ? (apply(nativeBase, nativeDocument, []) as string)
        : fallbackBase);
  const readHref = descriptor(NativeURL.prototype, 'href')!.get!;
  const readHash = descriptor(NativeURL.prototype, 'hash')!.get!;
  const writeHash = descriptor(NativeURL.prototype, 'hash')!.set!;
  const requestURL = descriptor(Request.prototype, 'url')?.get;
  if (!requestURL) throw new Error('Native request URL access is required');
  const readRequestURL = requestURL;

  let aliases = new Map<string, string>();
  let installed = new Set<string>();
  let sources = new Map<string, string>();

  function address(input: unknown): { href: string; hash: string } {
    const url = new NativeURL(String(input), getBase());
    const hash: string = apply(readHash, url, []);
    apply(writeHash, url, ['']);
    return { href: apply(readHref, url, []), hash };
  }

  function mapURL(input: unknown): string {
    const { href, hash } = address(input);
    return (aliases.get(href) ?? href) + hash;
  }

  function isInstalledURL(input: unknown): boolean {
    try {
      const { href } = address(input);
      return installed.has(aliases.get(href) ?? href);
    } catch {
      return false;
    }
  }

  function mapRequest(input: RequestInfo | URL): RequestInfo {
    return input instanceof NativeRequest
      ? new NativeRequest(mapURL(apply(readRequestURL, input, [])), input)
      : mapURL(input);
  }

  const getPrototype = Object.getPrototypeOf;
  let fetchOwner: object | null = target;
  while (fetchOwner && !descriptor(fetchOwner, 'fetch'))
    fetchOwner = getPrototype(fetchOwner);
  if (!fetchOwner) throw new Error('Native fetch owner is required');
  method(
    fetchOwner,
    'fetch',
    function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      return apply(nativeFetch, this, [mapRequest(input), init]);
    },
  );

  if (typeof XMLHttpRequest === 'function') {
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
  }

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
    isInstalledURL,
    sourceURL(input: unknown) {
      const { href, hash } = address(input);
      const original = sources.get(aliases.get(href) ?? href);
      return original === undefined ? undefined : original + hash;
    },
    install(entries: Iterable<readonly [string, string]>) {
      const next = new Map<string, string>();
      const targets = new Set<string>();
      const originals = new Map<string, string>();
      for (const [source, destination] of entries) {
        if (typeof source !== 'string' || typeof destination !== 'string')
          throw new TypeError('Resource aliases must be URL strings');
        const original = address(source).href;
        const mapped = address(destination).href;
        next.set(original, mapped);
        targets.add(mapped);
        originals.set(mapped, original);
      }
      aliases = next;
      installed = targets;
      sources = originals;
    },
  });
}
