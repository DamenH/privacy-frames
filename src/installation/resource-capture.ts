import type { DownloadedResource, UnavailableResource } from '../shared/types.ts';
import { digest, LIMITS, safePath } from '../shared/policy.ts';
import type { CapturedResponse } from './protocol.ts';
import { prepareDocument, cssReferences } from './document.ts';
import { moduleReferences, relocateModule } from './modules.ts';
import { scriptDependencies } from './script-dependencies.ts';
import { finiteResources } from './finite-resources.ts';
import { amdDependencies } from './amd-dependencies.ts';
import { relocateImportMeta } from '../shared/module-source.ts';
import type {
  ScriptExecution,
  ScriptDependency,
  UnresolvedScriptDependency,
  ScriptDependencies,
  ScriptLoader,
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
  unavailableResources: UnavailableResource[];
}

/** Only transport failures are eligible for partial capture. */
export class ResourceUnavailableError extends Error {
  readonly resource: UnavailableResource;
  constructor(resource: UnavailableResource) {
    super(
      resource.reason === 'http'
        ? `${resource.url}: HTTP ${resource.status}`
        : `${resource.url}: Resource unavailable (${resource.reason})`,
    );
    this.resource = resource;
  }
  get status(): number | undefined {
    return this.resource.status;
  }
}

export class CaptureLimitError extends Error {}

export interface CaptureGraph {
  readonly downloads: Map<string, Promise<CapturedResponse>>;
  readonly unavailable: Map<string, UnavailableResource>;
  readonly discovered: Set<string>;
  readonly adaptedHTML: Map<string, string>;
  readonly documents: Set<string>;
  readonly documentBases: Map<string, string>;
  readonly controller: AbortController;
  readonly executions: Map<string, Map<string, ScriptExecution>>;
  readonly analyzed: Map<string, Set<string>>;
  readonly moduleImports: Map<string, string[]>;
  readonly amdRealms: Set<string>;
  readonly loaders: Map<string, Map<string, ScriptLoader>>;
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
      unavailable: new Map(parent?.unavailable),
      discovered: new Set(parent?.discovered),
      adaptedHTML: new Map(parent?.adaptedHTML),
      documents: new Set(parent?.documents || [this.source.href]),
      documentBases: new Map(parent?.documentBases),
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
      amdRealms: new Set(parent?.amdRealms),
      loaders: new Map(
        [...(parent?.loaders || [])].map(([realm, entries]) => [realm, new Map(entries)]),
      ),
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
    if (this.bytesRead > LIMITS.bytes)
      throw new CaptureLimitError('Installation exceeds size limit');
  }

  async download(input: string, graph: CaptureGraph): Promise<CapturedResponse> {
    const url = publicResourceURL(input, this.scope).href;
    if (graph.closed) throw new Error('Installation capture has ended');
    graph.controller.signal.throwIfAborted();
    const existing = graph.downloads.get(url);
    if (existing) return existing;
    if (graph.downloads.size >= LIMITS.files || this.requests >= LIMITS.files)
      throw new CaptureLimitError('Too many installation resources');
    if (this.bytesRead >= LIMITS.bytes)
      throw new CaptureLimitError('Installation exceeds size limit');
    this.requests++;
    const promise = (async (): Promise<CapturedResponse> => {
      let response: Response;
      try {
        response = await fetch(url, {
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store',
          signal: graph.controller.signal,
        });
      } catch {
        graph.controller.signal.throwIfAborted();
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
          if (graph.closed) throw new Error('Installation capture has ended');
          graph.controller.signal.throwIfAborted();
          this.consume(part.value.byteLength);
          length += part.value.byteLength;
          chunks.push(part.value);
        }
      } catch (error) {
        await reader.cancel().catch(() => {});
        graph.controller.signal.throwIfAborted();
        if (error instanceof CaptureLimitError) {
          graph.controller.abort(error);
          throw error;
        }
        if (graph.closed) throw new Error('Installation capture has ended');
        throw new ResourceUnavailableError({ url, reason: 'body' });
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
    })().catch((error: unknown) => {
      if (error instanceof ResourceUnavailableError) {
        graph.unavailable.set(url, error.resource);
        this.onProgress(`Resource unavailable: ${url}`);
      }
      throw error;
    });
    graph.downloads.set(url, promise);
    return promise;
  }

  async downloadDependency(input: string, graph: CaptureGraph): Promise<void> {
    try {
      await this.download(input, graph);
    } catch (error) {
      if (!(error instanceof ResourceUnavailableError)) throw error;
    }
  }

  private async collected(graph: CaptureGraph): Promise<CapturedResponse[]> {
    const results = await Promise.allSettled(graph.downloads.values());
    const captured: CapturedResponse[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') captured.push(result.value);
      else if (!(result.reason instanceof ResourceUnavailableError)) throw result.reason;
    }
    graph.controller.signal.throwIfAborted();
    return captured;
  }

  inline(scripts: { url: string; code: string }[], graph: CaptureGraph): void {
    for (const script of scripts) {
      if (graph.closed) throw new Error('Installation capture has ended');
      graph.controller.signal.throwIfAborted();
      if (graph.downloads.size >= LIMITS.files)
        throw new CaptureLimitError('Too many prepared resources');
      const bytes = new TextEncoder().encode(script.code).buffer;
      this.consume(bytes.byteLength);
      graph.downloads.set(
        script.url,
        Promise.resolve({ url: script.url, bytes, contentType: 'text/javascript' }),
      );
      graph.unavailable.delete(script.url);
    }
  }

  document(
    document: ReturnType<typeof prepareDocument>,
    url: string,
    graph: CaptureGraph,
  ): void {
    graph.discovered.add(url);
    graph.adaptedHTML.set(url, document.html);
    graph.documentBases.set(url, document.baseURL);
    for (const child of document.documentURLs) graph.documents.add(child);
    this.inline(document.inlineScripts, graph);
    for (const script of document.scriptContexts)
      this.execution(
        script.url,
        {
          realm: 'window',
          baseURL: script.baseURL,
          documentURL: script.documentURL,
          ...(script.inline ? { moduleURL: script.baseURL } : {}),
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
      throw new CaptureLimitError('Too many prepared resources');
    graph.downloads.set(resource.url, Promise.resolve(resource));
    graph.unavailable.delete(resource.url);
    graph.discovered.delete(resource.url);
    graph.adaptedHTML.delete(resource.url);
    graph.documentBases.delete(resource.url);
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
      const pending = (await this.collected(graph)).filter(
        (item) =>
          (graph.executions.has(item.url) ||
            graph.documents.has(item.url) ||
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
          item.url === this.source.href ||
          (graph.documents.has(item.url) && /image\/svg\+xml/i.test(item.contentType))
        ) {
          const document = prepareDocument(code, item.url, {
            kind: /image\/svg\+xml/i.test(item.contentType) ? 'svg' : 'html',
          });
          this.document(document, item.url, graph);
          references = document.links;
        } else if (/text\/css/i.test(item.contentType)) {
          references = cssReferences(code, item.url);
        } else {
          references = await moduleReferences(code, item.url);
          graph.moduleImports.set(item.url, references);
        }
        await Promise.all(references.map((url) => this.downloadDependency(url, graph)));
      }
      let analyses = 0;
      for (const [url, executions] of graph.executions) {
        const captured = graph.downloads.get(url);
        if (!captured || !graph.moduleImports.has(url)) continue;
        let resource: CapturedResponse;
        try {
          resource = await captured;
        } catch (error) {
          if (error instanceof ResourceUnavailableError) continue;
          throw error;
        }
        let analyzed = graph.analyzed.get(url);
        if (!analyzed) {
          analyzed = new Set();
          graph.analyzed.set(url, analyzed);
        }
        for (const [key, execution] of executions) {
          const realmKey = `${execution.realm}:${execution.documentURL || execution.baseURL}`;
          const loaders = graph.loaders.get(realmKey);
          const analysisKey =
            key +
            (graph.amdRealms.has(realmKey) ? ':amd' : '') +
            ':' +
            (loaders?.size || 0);
          if (analyzed.has(analysisKey)) continue;
          analyzed.add(analysisKey);
          analyses++;
          this.analysisContexts++;
          this.analysisBytes += resource.bytes.byteLength;
          if (
            this.analysisContexts > LIMITS.files * 4 ||
            this.analysisBytes > LIMITS.bytes * 4
          )
            throw new CaptureLimitError(
              'Static dependency analysis exceeds its work budget',
            );
          const inherited: ScriptExecution = {
            realm: execution.realm,
            baseURL: execution.baseURL,
            ...(execution.documentURL ? { documentURL: execution.documentURL } : {}),
          };
          for (const dependency of graph.moduleImports.get(url) || [])
            this.execution(dependency, inherited, graph);
          const code = new TextDecoder().decode(resource.bytes);
          const context = {
            ...execution,
            sourceURL: url,
            loaders: [...(loaders?.values() || [])],
          };
          const ordinary = scriptDependencies(code, context);
          if (ordinary.loaders?.length) {
            const summaries = loaders || new Map<string, ScriptLoader>();
            for (const loader of ordinary.loaders)
              summaries.set(JSON.stringify(loader), loader);
            if (summaries.size > LIMITS.files)
              throw new CaptureLimitError('Too many installation loader summaries');
            graph.loaders.set(realmKey, summaries);
          }
          const amd = amdDependencies(code, context);
          if (amd.loader) graph.amdRealms.add(realmKey);
          const amdEnabled = graph.amdRealms.has(realmKey);
          const finite = finiteResources(code, context);
          const dependencies = {
            references: [
              ...ordinary.references,
              ...(amdEnabled ? amd.references : []),
              ...finite.references,
            ],
            unresolved: [
              ...ordinary.unresolved,
              ...(amdEnabled ? amd.unresolved : []),
              ...finite.assumptions,
            ],
            loaders: ordinary.loaders,
          };
          graph.scriptReferences.push(...dependencies.references);
          graph.unresolvedScripts.push(...dependencies.unresolved);
          this.onDiscovery({
            sourceURL: url,
            execution,
            optional: graph.optional,
            ...dependencies,
          });
          for (const dependency of dependencies.references) {
            if (dependency.kind !== 'resource')
              this.execution(
                dependency.url,
                dependency.kind === 'worker' || dependency.kind === 'shared-worker'
                  ? { realm: 'worker', baseURL: dependency.url }
                  : dependency.kind === 'audio-worklet' ||
                      dependency.kind === 'paint-worklet'
                    ? { realm: 'worklet', baseURL: dependency.url }
                    : dependency.kind === 'service-worker'
                      ? { realm: 'service-worker', baseURL: dependency.url }
                      : inherited,
                graph,
              );
            await this.downloadDependency(dependency.url, graph);
          }
        }
      }
      if (!pending.length && !analyses) return;
    }
  }

  async finalize(graph: CaptureGraph): Promise<FinalizedResources> {
    graph.controller.signal.throwIfAborted();
    const collected = await this.collected(graph);
    if (collected.length > LIMITS.files)
      throw new CaptureLimitError('Too many prepared resources');
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
        ...(graph.documentBases.has(url.href)
          ? { documentBase: graph.documentBases.get(url.href)! }
          : {}),
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
    if (size > LIMITS.bytes)
      throw new CaptureLimitError('Prepared application exceeds size limit');
    graph.controller.signal.throwIfAborted();
    return {
      resources,
      size,
      unavailableResources: [...graph.unavailable.values()],
    };
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
