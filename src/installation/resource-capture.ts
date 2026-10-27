import type { DownloadedResource } from '../shared/types.ts';
import { digest, LIMITS, safePath } from '../shared/policy.ts';
import type { CapturedResponse } from './protocol.ts';
import { prepareDocument, cssReferences } from './document.ts';
import { moduleReferences, relocateModule } from './modules.ts';
import { scriptDependencies, relocateImportMeta } from './script-dependencies.ts';
import type {
  ScriptExecution,
  ScriptDependency,
  UnresolvedScriptDependency,
  ScriptDependencies,
} from './script-dependencies.ts';

export interface ScriptDiscoveryEvent extends ScriptDependencies {
  sourceURL: string;
  execution: ScriptExecution;
  optional: boolean;
}

export function publicResourceURL(input: string, base?: string | URL): URL {
  const url = new URL(input, base);
  url.hash = '';
  if (
    url.username ||
    url.password ||
    !['https:', 'http:'].includes(url.protocol) ||
    (url.protocol === 'http:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    throw new Error('Installation requires public HTTPS resources');
  return url;
}

export interface FinalizedResources {
  resources: DownloadedResource[];
  size: number;
}

export interface CaptureGraph {
  readonly downloads: Map<string, Promise<CapturedResponse>>;
  readonly discovered: Set<string>;
  readonly adaptedHTML: Map<string, string>;
  readonly controller: AbortController;
  readonly executions: Map<string, Map<string, ScriptExecution>>;
  readonly analyzed: Map<string, Set<string>>;
  readonly moduleImports: Map<string, string[]>;
  readonly scriptReferences: ScriptDependency[];
  readonly unresolvedScripts: UnresolvedScriptDependency[];
  readonly optional: boolean;
  closed: boolean;
}

/** Independent discovery and optional preparation share budgets, never mutable graphs. */
export class ResourceCapture {
  private readonly graphs = new Set<CaptureGraph>();
  private bytesRead = 0;
  private requests = 0;
  private analysisBytes = 0;
  private analysisContexts = 0;

  readonly source: URL;
  readonly scope: URL;
  private readonly onProgress: (message: string) => void;
  private readonly onDiscovery: (event: ScriptDiscoveryEvent) => void;

  constructor(
    source: URL,
    scope: URL,
    onProgress: (message: string) => void,
    onDiscovery: (event: ScriptDiscoveryEvent) => void = () => {},
  ) {
    this.source = source;
    this.scope = scope;
    this.onProgress = onProgress;
    this.onDiscovery = onDiscovery;
  }

  graph(parent?: CaptureGraph): CaptureGraph {
    const graph: CaptureGraph = {
      downloads: new Map(parent?.downloads),
      discovered: new Set(parent?.discovered),
      adaptedHTML: new Map(parent?.adaptedHTML),
      controller: new AbortController(),
      executions: new Map(
        [...(parent?.executions || [])].map(([url, contexts]) => [
          url,
          new Map(contexts),
        ]),
      ),
      analyzed: new Map(
        [...(parent?.analyzed || [])].map(([url, contexts]) => [url, new Set(contexts)]),
      ),
      moduleImports: new Map(parent?.moduleImports),
      scriptReferences: [...(parent?.scriptReferences || [])],
      unresolvedScripts: [...(parent?.unresolvedScripts || [])],
      optional: !!parent,
      closed: false,
    };
    this.graphs.add(graph);
    return graph;
  }

  private consume(bytes: number): void {
    this.bytesRead += bytes;
    if (this.bytesRead > LIMITS.bytes) throw new Error('Installation exceeds size limit');
  }

  async download(input: string, graph: CaptureGraph): Promise<CapturedResponse> {
    const url = publicResourceURL(input, this.scope).href;
    if (graph.closed) throw new Error('Installation capture has ended');
    graph.controller.signal.throwIfAborted();
    const existing = graph.downloads.get(url);
    if (existing) return existing;
    if (graph.downloads.size >= LIMITS.files || this.requests >= LIMITS.files)
      throw new Error('Too many installation resources');
    if (this.bytesRead >= LIMITS.bytes)
      throw new Error('Installation exceeds size limit');
    this.requests++;
    const promise = (async (): Promise<CapturedResponse> => {
      const response = await fetch(url, {
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        signal: graph.controller.signal,
      });
      if (!response.ok)
        throw Object.assign(new Error(`${url}: HTTP ${response.status}`), {
          status: response.status,
        });
      if (!response.body) throw new Error('Resource response has no body');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          if (graph.closed) throw new Error('Installation capture has ended');
          graph.controller.signal.throwIfAborted();
          this.consume(part.value.byteLength);
          length += part.value.byteLength;
          chunks.push(part.value);
        }
      } catch (error) {
        graph.controller.abort();
        await reader.cancel().catch(() => {});
        throw error;
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      this.onProgress(`Preparing… ${graph.downloads.size} resources`);
      return {
        url,
        bytes: bytes.buffer,
        contentType: response.headers.get('Content-Type') || 'application/octet-stream',
      };
    })();
    graph.downloads.set(url, promise);
    return promise;
  }

  inline(scripts: { url: string; code: string }[], graph: CaptureGraph): void {
    for (const script of scripts) {
      if (graph.closed) throw new Error('Installation capture has ended');
      graph.controller.signal.throwIfAborted();
      if (graph.downloads.size >= LIMITS.files)
        throw new Error('Too many prepared resources');
      const bytes = new TextEncoder().encode(script.code).buffer;
      this.consume(bytes.byteLength);
      graph.downloads.set(
        script.url,
        Promise.resolve({ url: script.url, bytes, contentType: 'text/javascript' }),
      );
    }
  }

  document(
    document: ReturnType<typeof prepareDocument>,
    url: string,
    graph: CaptureGraph,
  ): void {
    graph.discovered.add(url);
    graph.adaptedHTML.set(url, document.html);
    this.inline(document.inlineScripts, graph);
    const inline = new Set(document.inlineScripts.map((script) => script.url));
    for (const scriptURL of document.scriptURLs)
      this.execution(
        scriptURL,
        {
          realm: 'window',
          baseURL: document.baseURL,
          documentURL: url,
          ...(inline.has(scriptURL) ? { moduleURL: document.baseURL } : {}),
        },
        graph,
      );
  }

  private execution(url: string, context: ScriptExecution, graph: CaptureGraph): void {
    url = publicResourceURL(url).href;
    let contexts = graph.executions.get(url);
    if (!contexts) {
      contexts = new Map();
      graph.executions.set(url, contexts);
    }
    contexts.set(JSON.stringify(context), context);
  }

  replace(resource: CapturedResponse, graph: CaptureGraph): void {
    if (!graph.downloads.has(resource.url) && graph.downloads.size >= LIMITS.files)
      throw new Error('Too many prepared resources');
    graph.downloads.set(resource.url, Promise.resolve(resource));
    graph.discovered.delete(resource.url);
    graph.adaptedHTML.delete(resource.url);
    graph.analyzed.delete(resource.url);
    graph.moduleImports.delete(resource.url);
    const references = graph.scriptReferences.filter(
      (reference) => reference.sourceURL !== resource.url,
    );
    graph.scriptReferences.splice(0, graph.scriptReferences.length, ...references);
    const unresolved = graph.unresolvedScripts.filter(
      (reference) => reference.sourceURL !== resource.url,
    );
    graph.unresolvedScripts.splice(0, graph.unresolvedScripts.length, ...unresolved);
  }

  async discover(graph: CaptureGraph): Promise<void> {
    while (true) {
      graph.controller.signal.throwIfAborted();
      const pending = (await Promise.all(graph.downloads.values())).filter(
        (item) =>
          (graph.executions.has(item.url) ||
            /(?:text\/html|text\/css|javascript|ecmascript)/i.test(item.contentType) ||
            new URL(item.url).pathname.endsWith('.html') ||
            item.url === this.source.href) &&
          !graph.discovered.has(item.url),
      );
      for (const item of pending) {
        graph.discovered.add(item.url);
        const code = new TextDecoder().decode(item.bytes);
        let references: string[];
        if (
          /text\/html/i.test(item.contentType) ||
          new URL(item.url).pathname.endsWith('.html') ||
          item.url === this.source.href
        ) {
          const document = prepareDocument(code, item.url);
          this.document(document, item.url, graph);
          references = document.links;
        } else if (/text\/css/i.test(item.contentType)) {
          references = cssReferences(code, item.url);
        } else {
          references = await moduleReferences(code, item.url);
          graph.moduleImports.set(item.url, references);
        }
        await Promise.all(references.map((url) => this.download(url, graph)));
      }
      let analyses = 0;
      for (const [url, executions] of graph.executions) {
        const captured = graph.downloads.get(url);
        if (!captured || !graph.moduleImports.has(url)) continue;
        const resource = await captured;
        let analyzed = graph.analyzed.get(url);
        if (!analyzed) {
          analyzed = new Set();
          graph.analyzed.set(url, analyzed);
        }
        for (const [key, execution] of executions) {
          if (analyzed.has(key)) continue;
          analyzed.add(key);
          analyses++;
          this.analysisContexts++;
          this.analysisBytes += resource.bytes.byteLength;
          if (
            this.analysisContexts > LIMITS.files * 4 ||
            this.analysisBytes > LIMITS.bytes * 4
          )
            throw new Error('Static dependency analysis exceeds its work budget');
          const inherited: ScriptExecution = {
            realm: execution.realm,
            baseURL: execution.baseURL,
            ...(execution.documentURL ? { documentURL: execution.documentURL } : {}),
          };
          for (const dependency of graph.moduleImports.get(url) || [])
            this.execution(dependency, inherited, graph);
          const dependencies = scriptDependencies(
            new TextDecoder().decode(resource.bytes),
            { ...execution, sourceURL: url },
          );
          graph.scriptReferences.push(...dependencies.references);
          graph.unresolvedScripts.push(...dependencies.unresolved);
          this.onDiscovery({
            sourceURL: url,
            execution,
            optional: graph.optional,
            ...dependencies,
          });
          for (const dependency of dependencies.references) {
            this.execution(
              dependency.url,
              dependency.kind === 'worker' || dependency.kind === 'shared-worker'
                ? { realm: 'worker', baseURL: dependency.url }
                : inherited,
              graph,
            );
            await this.download(dependency.url, graph);
          }
        }
      }
      if (!pending.length && !analyses) return;
    }
  }

  async finalize(graph: CaptureGraph): Promise<FinalizedResources> {
    graph.controller.signal.throwIfAborted();
    const collected = await Promise.all(graph.downloads.values());
    if (collected.length > LIMITS.files) throw new Error('Too many prepared resources');
    const paths = new Set<string>();
    const resources: DownloadedResource[] = [];
    for (const item of collected) {
      if (
        !(item.bytes instanceof ArrayBuffer) ||
        typeof item.contentType !== 'string' ||
        item.contentType.length > 200
      )
        throw new Error('Invalid captured resource');
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
      const html = graph.adaptedHTML.get(url.href);
      const bytes =
        html === undefined ? item.bytes : new TextEncoder().encode(html).buffer;
      resources.push({
        ...item,
        url: url.href,
        path,
        bytes,
        sha256: await digest(bytes),
      });
    }
    const resourcePaths = new Map(
      resources.map((resource) => [resource.url, resource.path]),
    );
    for (const resource of resources) {
      if (!/javascript|ecmascript/i.test(resource.contentType)) continue;
      const text = new TextDecoder().decode(resource.bytes);
      const moduleURL =
        [...(graph.executions.get(resource.url)?.values() || [])].find(
          (execution) => execution.moduleURL,
        )?.moduleURL || resource.url;
      const moduleSource = relocateImportMeta(text, moduleURL);
      const relocated = await relocateModule(
        moduleSource,
        resource.url,
        resource.path,
        resourcePaths,
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
    if (size > LIMITS.bytes) throw new Error('Prepared application exceeds size limit');
    graph.controller.signal.throwIfAborted();
    return { resources, size };
  }

  async close(graph: CaptureGraph): Promise<void> {
    graph.closed = true;
    graph.controller.abort();
    await Promise.allSettled(graph.downloads.values());
    this.graphs.delete(graph);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.graphs].map((graph) => this.close(graph)));
  }
}
