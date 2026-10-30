import { strings, internalRecord } from '../../shared/primordials.ts';
import { parseDocumentSurface } from './document-surface.ts';
import { applicationURL } from '../../shared/runtime-url.ts';
import { response } from '../response-policy.ts';
import { getApp, getResource } from '../storage.ts';
import type { StoredInstallation } from '../storage.ts';
import { CONTEXT_POLICY_VERSION, ContextRegistry } from './model.ts';
import { DocumentIntentStore } from './document-intents.ts';
import type { DocumentIntentMetadata } from './document-intents.ts';
import type { DocumentBootstrapConfiguration } from './document-protocol.ts';
import { documentRequestInput, readDocumentRequest } from './document-request.ts';
interface DocumentControllerOptions {
  base: URL;
  contexts: ContextRegistry;
  intents: DocumentIntentStore;
  client(id: string): Promise<Client | undefined>;
  application(client: Client): Promise<string | null>;
  bootstrap(): Promise<Response | undefined>;
}
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const routePattern = new RegExp(
  `/__contexts/(${UUID})/(document\\.(?:html|svg)|configuration|content|close)$`,
);
function bootstrapURL(
  app: StoredInstallation,
  intent: DocumentIntentMetadata,
  base: URL,
): URL {
  return new URL(
    `__contexts/${intent.id}/document.${intent.kind}`,
    applicationURL(app, base),
  );
}
function json(value: unknown, status = 200): Response {
  return response(JSON.stringify(value), 'application/json', status);
}
/** Only native browser identities select the owner of registration and payloads. */
export function createDocumentController(options: DocumentControllerOptions) {
  const { base, contexts, intents } = options;
  async function owner(clientId: string): Promise<
    | {
        client: Client;
        app: StoredInstallation;
      }
    | undefined
  > {
    if (!clientId) return;
    const client = await options.client(clientId);
    if (!client || client.type !== 'window') return;
    const application = await options.application(client);
    const app = application ? await getApp(application) : undefined;
    return app?.generation ? internalRecord({ client, app }) : undefined;
  }
  async function parentStillOwns(intent: DocumentIntentMetadata): Promise<boolean> {
    const parent = await owner(intent.parentClient);
    return (
      parent?.app.id === intent.application &&
      parent.app.generation === intent.installationGeneration
    );
  }
  return async function documentContextResponse(
    event: FetchEvent,
  ): Promise<Response | undefined> {
    const request = event.request;
    const url = new URL(request.url);
    url.hash = '';
    if (url.origin !== base.origin) return;
    // Trusted code is public, but this entry point serves only a reserved child.
    // Avoid clients.get while its first parser-blocking script is still loading.
    if (url.pathname === new URL('document-guard.js', base).pathname) {
      const id = url.searchParams.get('context');
      if (
        request.method !== 'GET' ||
        request.destination !== 'script' ||
        request.mode === 'navigate' ||
        !id ||
        url.search !== '?context=' + id ||
        !new RegExp('^' + UUID + '$').test(id)
      )
        return Response.error();
      const intent = await intents.inspect(id);
      if (!intent || intent.state !== 'bound' || intent.childClient !== event.clientId)
        return Response.error();
      const app = await getApp(intent.application);
      const bound =
        app &&
        (await contexts.resolve(
          internalRecord({
            id: event.clientId,
            url: bootstrapURL(app, intent, base).href,
          }),
        ));
      if (!app || app.generation !== intent.installationGeneration || bound?.id !== id)
        return Response.error();
      return (await options.bootstrap()) || Response.error();
    }
    if (strings.endsWith(url.pathname, '/__document-intents')) {
      if (
        request.method !== 'POST' ||
        request.destination !== '' ||
        request.mode === 'navigate' ||
        url.search
      )
        return Response.error();
      const parent = await owner(event.clientId);
      if (
        !parent ||
        url.href !== new URL('__document-intents', applicationURL(parent.app, base)).href
      )
        return Response.error();
      try {
        const body = await readDocumentRequest(request);
        const surface = parseDocumentSurface(body, true);
        const input = await documentRequestInput(
          body,
          parent.app,
          base,
          internalRecord({ getResource }),
        );
        const intent = await intents.issue(
          internalRecord({
            application: parent.app.id,
            installationGeneration: parent.app.generation,
            parentClient: parent.client.id,
          }),
          input,
          surface,
        );
        return json(
          internalRecord({
            id: intent.id,
            nonce: intent.nonce,
            parentToken: intent.parentToken,
            kind: intent.kind,
            carrier: intent.carrier,
            ...(intent.popup
              ? internalRecord({ popup: intent.popup })
              : internalRecord({})),
            url: bootstrapURL(parent.app, intent, base).href,
          }),
        );
      } catch (error) {
        return json(
          internalRecord({
            error: error instanceof Error ? error.message : 'Document source refused',
          }),
          400,
        );
      }
    }
    const match = strings.match(url.pathname, routePattern);
    if (!match) return;
    const intent = await intents.inspect(match[1]);
    if (!intent) return match[2] === 'close' ? undefined : Response.error();
    const app = await getApp(intent.application);
    if (!app || app.generation !== intent.installationGeneration) return Response.error();
    const target = bootstrapURL(app, intent, base);
    const expected = new URL(match[2], target);
    if (url.href !== expected.href || url.search) return Response.error();
    if (strings.startsWith(match[2], 'document.')) {
      if (
        request.method !== 'GET' ||
        request.mode !== 'navigate' ||
        request.destination !== (intent.carrier === 'popup' ? 'document' : 'iframe') ||
        !event.resultingClientId ||
        match[2] !== 'document.' + intent.kind ||
        !(await parentStillOwns(intent))
      )
        return Response.error();
      const bound = await intents.bind(
        internalRecord({ id: intent.id, nonce: intent.nonce }),
        event.resultingClientId,
        app.generation,
      );
      if (!bound) return Response.error();
      try {
        await contexts.bind(
          event.resultingClientId,
          internalRecord({
            policyVersion: CONTEXT_POLICY_VERSION,
            id: intent.id,
            application: app.id,
            installationGeneration: app.generation,
            parent: intent.parentClient,
            kind: 'window',
            state: 'preparing',
            url: target.href,
          }),
        );
      } catch (error) {
        await intents.close(intent.id, intent, intent.parentToken);
        throw error;
      }
      const source = new URL('document-guard.js', base);
      source.search = '?context=' + intent.id;
      const script = `<script ${intent.kind === 'svg' ? 'href' : 'src'}="${source.href}" nonce="${intent.nonce}" data-privacy-context="${intent.id}"></script>`;
      const shell =
        intent.kind === 'svg'
          ? `<svg xmlns="http://www.w3.org/2000/svg">${script}</svg>`
          : `<!doctype html><html><head><meta charset="utf-8">${script}</head><body></body></html>`;
      const directory = new URL('__contexts/', applicationURL(app, base)).href;
      return response(
        shell,
        intent.kind === 'svg' ? 'image/svg+xml' : 'text/html',
        200,
        internalRecord({
          scriptNonce: intent.nonce,
          popups: true,
          workerSource: directory,
          frameSource: directory,
          controllerSource: new URL('sw.js', base).href,
          embedded: intent.carrier === 'frame',
        }),
      );
    }
    if (match[2] === 'close') {
      if (
        request.method !== 'POST' ||
        request.destination !== '' ||
        request.mode === 'navigate'
      )
        return Response.error();
      const parent = await owner(event.clientId);
      if (!parent || parent.app.id !== app.id) return Response.error();
      const body = await readDocumentRequest(request);
      if (
        !body ||
        typeof body !== 'object' ||
        !('parentToken' in body) ||
        typeof body.parentToken !== 'string'
      )
        return Response.error();
      const closed = await intents.close(
        intent.id,
        internalRecord({
          application: app.id,
          installationGeneration: app.generation,
          parentClient: parent.client.id,
        }),
        body.parentToken,
      );
      if (closed) await contexts.closeChild(parent.client.id, app.id, intent.id);
      return json(internalRecord({ closed }), closed ? 200 : 403);
    }
    if (
      request.method !== 'GET' ||
      request.destination !== '' ||
      request.mode === 'navigate' ||
      event.resultingClientId
    )
      return Response.error();
    const actual = await owner(event.clientId);
    const identity = actual && (await contexts.resolve(actual.client));
    if (
      !actual ||
      actual.app.id !== app.id ||
      identity?.id !== intent.id ||
      identity.kind !== 'window' ||
      intent.childClient !== actual.client.id
    )
      return Response.error();
    const key = internalRecord({ id: intent.id, nonce: intent.nonce });
    if (match[2] === 'configuration') {
      const content = await intents.read(key, actual.client.id, app.generation);
      if (!content) return Response.error();
      const configuration: DocumentBootstrapConfiguration = internalRecord({
        id: intent.id,
        nonce: intent.nonce,
        parentToken: intent.parentToken,
        policyVersion: CONTEXT_POLICY_VERSION,
        kind: intent.kind,
        carrier: intent.carrier,
        ...(intent.popup ? internalRecord({ popup: intent.popup }) : internalRecord({})),
        url: target.href,
        application: app.id,
        installationGeneration: app.generation,
        applicationURL: applicationURL(app, base).href,
        runtimeURL: base.href,
        content: internalRecord({
          installationGeneration: app.generation,
          aliases: content.input.aliases.map(([source, mapped]) => [source, mapped]),
          source: app.source,
          documentBase: content.input.baseURL || content.input.sourceURL,
        }),
      });
      return json(configuration);
    }
    const content = await intents.consume(key, actual.client.id, app.generation);
    if (!content) return Response.error();
    if (!(await contexts.isCurrent(actual.client, identity))) return Response.error();
    return json(content.input);
  };
}
