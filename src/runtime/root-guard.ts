import {
  internalArray,
  internalData,
  ownDescriptor,
  internalRecord,
} from '../shared/primordials.ts';
import { applicationIdentity, publicAlias } from '../shared/runtime-url.ts';
import { createDocumentRenderer } from './contexts/document-renderer.ts';
import { parseInstalledDocument } from './contexts/document-protocol.ts';
import { prepareWindowRealm } from './contexts/window-realm.ts';

// The entry installs document-exit cancellation before initializing this module.
// Capture startup operations before preparing the realm or running application code.
const nativeApply = Reflect.apply;
const nativeFetch = window.fetch;
const responseJSON = Response.prototype.json;
const responseOK = ownDescriptor(Response.prototype, 'ok')!.get!;
const rawText = ownDescriptor(Node.prototype, 'textContent')!.set!;
const rawCreate = Document.prototype.createElement;
const rawAppend = Node.prototype.appendChild;
const nativeDocument = document;
const nativeWindow = window;
const trustedBody = document.body;
const manifest = document.querySelector('head > link[rel="manifest"]');
const logError = console.error.bind(console);

function failure(title: string, description: string) {
  nativeApply(rawText, trustedBody, ['']);
  for (const [tag, text] of [
    ['h1', title],
    ['p', description],
  ]) {
    const node = nativeApply(rawCreate, nativeDocument, [tag]);
    nativeApply(rawText, node, [text]);
    nativeApply(rawAppend, trustedBody, [node]);
  }
}

export function startRootGuard(bootstrapScript: Element | null) {
  try {
    if (window.top !== window || window.parent !== window || window.opener !== null)
      throw new Error(
        'Confined applications require a top-level document without an opener',
      );
    if (!(bootstrapScript instanceof HTMLScriptElement))
      throw new Error('Trusted bootstrap script is missing');
    const guardURL = new URL(bootstrapScript.src);
    const app = bootstrapScript.getAttribute('data-installation');
    const entry = bootstrapScript.getAttribute('data-application-url');
    const route = applicationIdentity(location.href, new URL('./', guardURL));
    if (!app || !entry || route !== publicAlias(app))
      throw new Error('Invalid runtime identity');
    const appURL = new URL(entry);
    if (applicationIdentity(appURL, new URL('./', guardURL)) !== route)
      throw new Error('Invalid canonical application URL');
    const realm = prepareWindowRealm(
      internalRecord({
        application: app,
        applicationURL: appURL.href,
        scriptNonce: bootstrapScript.nonce,
        enableDocumentContexts: true,
      }),
    );
    const renderer = createDocumentRenderer(
      internalRecord({
        nonce: bootstrapScript.nonce,
        scripts: realm.scripts,
        resources: realm.resources,
        prepareContext: realm.documents?.prepareContext,
        contextsLoaded: realm.documents?.whenLoaded,
        contextsPrepared: realm.documents?.whenPrepared,
        deferChildStartup: realm.documents?.deferChildStartup,
        retainedHeadNodes: manifest ? internalArray([manifest]) : internalArray(),
      }),
    );
    const content = new URL(appURL);
    content.search = '?host-content=1';
    const start = async () => {
      const response = await nativeApply(nativeFetch, nativeWindow, [content.href]);
      if (!nativeApply(responseOK, response, []))
        throw new Error('Installed content unavailable');
      const data = parseInstalledDocument(
        internalData(await nativeApply(responseJSON, response, [])),
        appURL.href,
      );
      realm.admitContent(data);
      const compiled = realm.policy.compile(data.document);
      renderer.prepare(compiled);
      await renderer.render(compiled);
      realm.documents?.settle();
    };
    void start().catch((error: unknown) => {
      failure('Application could not start', 'Reload or reinstall this application.');
      logError(error);
    });
  } catch (error) {
    failure(
      'Application refused',
      'The browser could not establish the required runtime restrictions.',
    );
    throw error;
  }
}
