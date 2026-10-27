import { validateMarkup } from '../shared/policy.ts';
import { applicationIdentity, publicAlias } from '../shared/runtime-url.ts';
import { prepareWindowRealm } from './contexts/window-realm.ts';
import type { WindowContentMetadata } from './contexts/window-realm.ts';

interface InstalledContent extends WindowContentMetadata {
  head: string;
  body: string;
  manifestURL?: string;
  attributes?: {
    html?: { name: string; value: string }[];
    body?: { name: string; value: string }[];
  };
  scripts: { src: string; type?: string }[];
}

// Only this trusted script exists in the initial document. Application content
// and scripts are loaded from a verified worker response after setup succeeds.
const rawHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')!.set!;
const rawCreate = Document.prototype.createElement,
  rawAppend = Node.prototype.appendChild;
const rawAttr = Element.prototype.setAttribute;
const trustedHead = document.head,
  trustedBody = document.body;
const nativeApply = Reflect.apply;
// This code is always parser-blocking and precedes all application markup.
// No native method captured here is published to application code.
try {
  if (window.top !== window || window.parent !== window || window.opener !== null)
    throw new Error(
      'Confined applications require a top-level document without an opener',
    );
  const bootstrapScript = document.currentScript;
  if (!(bootstrapScript instanceof HTMLScriptElement))
    throw new Error('Trusted bootstrap script is missing');
  const guardURL = new URL(bootstrapScript.src);
  const app = bootstrapScript.getAttribute('data-installation');
  const route = applicationIdentity(location.href, new URL('./', guardURL));
  if (!app || route !== publicAlias(app)) throw new Error('Invalid runtime identity');
  const appURL = new URL(location.href);
  appURL.search = '';
  appURL.hash = '';
  const realm = prepareWindowRealm({
    application: app,
    applicationURL: appURL.href,
    scriptNonce: bootstrapScript.nonce,
  });
  // Static metadata contains no host authority; applications may inspect it.

  document.documentElement.dataset.hostReady = 'true';
  const content = new URL(location.href);
  content.search = '?host-content=1';
  fetch(content)
    .then((r) => {
      if (!r.ok) throw new Error('Installed content unavailable');
      return r.json() as Promise<InstalledContent>;
    })
    .then(async (data) => {
      // Markup was independently validated by the worker. No app script executes in this parsing step.
      validateMarkup(data.head, { initial: true });
      validateMarkup(data.body, { initial: true });
      realm.admitContent(data);
      // Keep the bootstrap's manifest link continuously attached. Native PWA
      // installation can inspect it while the asynchronous app content is loading.
      const template = nativeApply(rawCreate, document, [
        'template',
      ]) as HTMLTemplateElement;
      nativeApply(rawHTML, template, [data.head]);
      for (const child of Array.from(template.content.childNodes))
        nativeApply(rawAppend, trustedHead, [child]);
      nativeApply(rawHTML, trustedBody, [data.body]);
      for (const [target, attributes] of [
        [document.documentElement, data.attributes?.html],
        [trustedBody, data.attributes?.body],
      ] as const)
        for (const attr of attributes || [])
          nativeApply(rawAttr, target, [attr.name, attr.value]);
      if (data.manifestURL && !document.querySelector('link[rel="manifest"]')) {
        const link = nativeApply(rawCreate, document, ['link']);
        nativeApply(rawAttr, link, ['rel', 'manifest']);
        nativeApply(rawAttr, link, ['href', data.manifestURL]);
        nativeApply(rawAppend, trustedHead, [link]);
      }
      for (const script of data.scripts) {
        await new Promise<void>((resolve, reject) => {
          const node = nativeApply(rawCreate, document, ['script']) as HTMLScriptElement;
          nativeApply(rawAttr, node, ['src', script.src]);
          if (script.type) nativeApply(rawAttr, node, ['type', script.type]);
          node.onload = () => resolve();
          node.onerror = () => reject(new Error('Installed script failed'));
          nativeApply(rawAppend, trustedHead, [node]);
        });
      }
    })
    .catch((error) => {
      nativeApply(rawHTML, trustedBody, [
        '<h1>Application could not start</h1><p>Reload or reinstall this application.</p>',
      ]);
      console.error(error);
    });
} catch (error) {
  // Parsing must never proceed into untrusted scripts after setup failure.
  nativeApply(rawHTML, trustedBody, [
    '<h1>Application refused</h1><p>The browser could not establish the required runtime restrictions.</p>',
  ]);
  throw error;
}
