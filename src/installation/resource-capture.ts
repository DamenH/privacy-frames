import type { DownloadedResource, UnavailableResource } from '../shared/types.ts';
import { digest, LIMITS, safePath } from '../shared/policy.ts';
import { prepareDocument, cssReferences } from './document.ts';
import type { PreparedSourceDocument } from './document.ts';
import { analyzeModule, relocateModule } from './modules.ts';
import type { ModuleAnalysis } from './modules.ts';
import { relocateImportMeta } from '../shared/module-source.ts';
import { publicResourceURL } from './resource-list.ts';

export { publicResourceURL } from './resource-list.ts';
export interface CapturedResponse {
  url: string;
  bytes: ArrayBuffer;
  contentType: string;
}
export interface FinalizedResources {
  resources: DownloadedResource[];
  size: number;
  unavailableResources: UnavailableResource[];
}
export class ResourceUnavailableError extends Error {
  readonly resource: UnavailableResource;
  constructor(resource: UnavailableResource) {
    super(
      resource.url +
        ': ' +
        (resource.status ? 'HTTP ' + resource.status : resource.reason),
    );
    this.resource = resource;
  }
}
export class CaptureLimitError extends Error {}

/** Collect explicit resource references; publisher JavaScript is never evaluated. */
export class ResourceCapture {
  private readonly downloads = new Map<string, Promise<CapturedResponse>>();
  private readonly unavailable = new Map<string, UnavailableResource>();
  private readonly required = new Set<string>();
  private readonly queued = new Set<string>();
  private readonly processed = new Set<string>();
  private readonly documents = new Set<string>();
  private readonly adaptedHTML = new Map<string, string>();
  private readonly documentBases = new Map<string, string>();
  private readonly moduleBases = new Map<string, string>();
  private readonly analyses = new Map<string, ModuleAnalysis>();
  private readonly controller = new AbortController();
  private bytesRead = 0;
  private requests = 0;
  private closed = false;

  readonly source: URL;
  readonly scope: URL;
  private readonly onProgress: (message: string) => void;
  constructor(source: URL, scope: URL, onProgress: (message: string) => void = () => {}) {
    this.source = source;
    this.scope = scope;
    this.onProgress = onProgress;
  }

  get metrics() {
    return {
      downloadRequests: this.requests,
      downloadedBytes: this.bytesRead,
      moduleAnalyses: this.analyses.size,
    };
  }

  private checkOpen(): void {
    if (this.closed) throw new Error('Installation capture has ended');
    this.controller.signal.throwIfAborted();
  }

  private async read(
    input: string,
    maxBytes: number = LIMITS.bytes,
  ): Promise<CapturedResponse> {
    this.checkOpen();
    const url = publicResourceURL(input).href;
    if (++this.requests > LIMITS.files + 1)
      throw new CaptureLimitError('Too many installation requests');
    let response: Response;
    try {
      response = await fetch(url, {
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(30_000)]),
      });
    } catch {
      this.checkOpen();
      throw new ResourceUnavailableError({ url, reason: 'network' });
    }
    if (!response.ok)
      throw new ResourceUnavailableError({
        url,
        reason: 'http',
        status: response.status,
      });
    if (!response.body) throw new ResourceUnavailableError({ url, reason: 'body' });
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        this.checkOpen();
        length += part.value.byteLength;
        this.bytesRead += part.value.byteLength;
        if (length > maxBytes || this.bytesRead > LIMITS.bytes)
          throw new CaptureLimitError('Installation download exceeds size limit: ' + url);
        chunks.push(part.value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      if (error instanceof CaptureLimitError) {
        this.controller.abort(error);
        throw error;
      }
      this.checkOpen();
      throw new ResourceUnavailableError({ url, reason: 'body' });
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      url,
      bytes: bytes.buffer,
      contentType: response.headers.get('Content-Type') || 'application/octet-stream',
    };
  }

  /** The control list is bounded and downloaded as data, not installed as an asset. */
  async readList(url: string, maxBytes: number): Promise<string> {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      (await this.read(url, maxBytes)).bytes,
    );
  }

  async download(input: string): Promise<CapturedResponse> {
    this.checkOpen();
    const url = publicResourceURL(input, this.scope).href;
    const existing = this.downloads.get(url);
    if (existing) return existing;
    if (this.downloads.size >= LIMITS.files)
      throw new CaptureLimitError('Too many installation resources');
    const response = this.read(url).catch((error: unknown) => {
      if (error instanceof ResourceUnavailableError)
        this.unavailable.set(url, error.resource);
      throw error;
    });
    this.downloads.set(url, response);
    return response;
  }

  add(input: string, required = false): void {
    this.checkOpen();
    const url = publicResourceURL(input, this.scope).href;
    if (required) this.required.add(url);
    if (!this.processed.has(url)) this.queued.add(url);
    if (new Set([...this.downloads.keys(), ...this.queued]).size > LIMITS.files)
      throw new CaptureLimitError('Too many installation resources');
  }

  document(document: PreparedSourceDocument, url: string): void {
    this.processed.add(url);
    this.adaptedHTML.set(url, document.html);
    this.documentBases.set(url, document.baseURL);
    for (const child of document.documentURLs) this.documents.add(child);
    for (const script of document.inlineScripts) {
      if (
        this.downloads.has(script.url) ||
        this.queued.has(script.url) ||
        document.links.includes(script.url)
      )
        throw new Error('Generated script URL collides with a publisher resource');
      if (this.downloads.size >= LIMITS.files)
        throw new CaptureLimitError('Too many installation resources');
      this.downloads.set(
        script.url,
        Promise.resolve({
          url: script.url,
          bytes: new TextEncoder().encode(script.code).buffer,
          contentType: 'text/javascript',
        }),
      );
      this.add(script.url);
    }
    for (const script of document.scriptContexts)
      if (script.inline) this.moduleBases.set(script.url, script.baseURL);
    for (const link of document.links) this.add(link);
  }

  async discover(): Promise<void> {
    while (this.queued.size) {
      this.checkOpen();
      const batch = [...this.queued].slice(0, 6);
      for (const url of batch) this.queued.delete(url);
      const captured = await Promise.all(
        batch.map(async (url) => {
          try {
            return await this.download(url);
          } catch (error) {
            if (!(error instanceof ResourceUnavailableError) || this.required.has(url))
              throw error;
            this.onProgress('Resource unavailable: ' + url);
            return undefined;
          }
        }),
      );
      for (const resource of captured) {
        if (!resource || this.processed.has(resource.url)) continue;
        this.processed.add(resource.url);
        const type = resource.contentType.split(';')[0].toLowerCase().trim();
        const pathname = new URL(resource.url).pathname;
        if (
          type === 'text/html' ||
          /\.html?$/i.test(pathname) ||
          this.documents.has(resource.url)
        ) {
          this.document(
            prepareDocument(new TextDecoder().decode(resource.bytes), resource.url, {
              kind: type === 'image/svg+xml' ? 'svg' : 'html',
            }),
            resource.url,
          );
        } else if (type === 'text/css' || /\.css$/i.test(pathname)) {
          for (const url of cssReferences(
            new TextDecoder().decode(resource.bytes),
            resource.url,
          ))
            this.add(url);
        } else if (/javascript|ecmascript/i.test(type) || /\.m?js$/i.test(pathname)) {
          const analysis = await analyzeModule(
            new TextDecoder().decode(resource.bytes),
            this.moduleBases.get(resource.url) || resource.url,
          );
          this.analyses.set(resource.url, analysis);
          for (const url of analysis.references) this.add(url);
        }
      }
      this.onProgress('Collecting… ' + this.downloads.size + ' resources');
    }
  }

  async finalize(): Promise<FinalizedResources> {
    this.checkOpen();
    const results = await Promise.allSettled(this.downloads.values());
    const paths = new Set<string>();
    const resources: DownloadedResource[] = [];
    for (const result of results) {
      if (result.status === 'rejected') {
        if (!(result.reason instanceof ResourceUnavailableError)) throw result.reason;
        if (this.required.has(result.reason.resource.url)) throw result.reason;
        continue;
      }
      const item = result.value;
      const url = publicResourceURL(item.url);
      let path =
        url.href === this.source.href
          ? 'index.html'
          : url.origin === this.scope.origin && url.href.startsWith(this.scope.href)
            ? url.pathname.slice(this.scope.pathname.length)
            : '';
      try {
        safePath(path);
        if (paths.has(path)) throw new Error('Duplicate path');
      } catch {
        path =
          'resources/' +
          (await digest(new TextEncoder().encode(url.href))) +
          '.' +
          (url.pathname.match(/\.([a-z0-9]{1,8})$/i)?.[1] || 'bin');
      }
      paths.add(path);
      const html = this.adaptedHTML.get(url.href);
      const bytes =
        html === undefined ? item.bytes : new TextEncoder().encode(html).buffer;
      resources.push({
        ...item,
        path,
        bytes,
        sha256: await digest(bytes),
        ...(this.documentBases.has(url.href)
          ? { documentBase: this.documentBases.get(url.href)! }
          : {}),
      });
    }
    const resourcePaths = new Map(
      resources.map((resource) => [resource.url, resource.path]),
    );
    for (const resource of resources) {
      const analysis = this.analyses.get(resource.url);
      if (!analysis) continue;
      const text = new TextDecoder().decode(resource.bytes);
      let relocated = await relocateModule(
        text,
        resource.url,
        resource.path,
        resourcePaths,
        analysis,
      );
      if (analysis.hasImportMeta)
        relocated = relocateImportMeta(
          relocated,
          this.moduleBases.get(resource.url) || resource.url,
        );
      if (text !== relocated) {
        resource.bytes = new TextEncoder().encode(relocated).buffer;
        resource.sha256 = await digest(resource.bytes);
      }
    }
    const size = resources.reduce(
      (total, resource) => total + resource.bytes.byteLength,
      0,
    );
    if (size > LIMITS.bytes)
      throw new CaptureLimitError('Prepared application exceeds size limit');
    this.checkOpen();
    return { resources, size, unavailableResources: [...this.unavailable.values()] };
  }

  close(): void {
    this.closed = true;
    this.controller.abort();
  }
}
