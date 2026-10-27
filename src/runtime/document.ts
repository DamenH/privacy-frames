import { serialize, type DefaultTreeAdapterTypes as Tree } from 'parse5';
import {
  validateMarkup,
  isDataScript,
  isExecutableScriptType,
} from '../shared/policy.ts';
import { applicationURL, resourceURL } from '../shared/runtime-url.ts';
import type { Installation } from '../shared/types.ts';
import { manifestURL } from './pwa.ts';

export function alias(
  app: Installation,
  input: string,
  base: string,
  runtime: URL,
): string {
  if (input.startsWith('#')) return input;
  try {
    const url = new URL(input, base),
      hash = url.hash;
    url.hash = '';
    const resource = app.resources.find((item) => item.url === url.href);
    return resource ? resourceURL(app, resource.path, runtime).href + hash : input;
  } catch {
    return input;
  }
}

export function css(app: Installation, text: string, base: string, runtime: URL): string {
  return text
    .replace(
      /url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/gi,
      (whole, double, single, plain) => {
        const value = double ?? single ?? plain;
        const mapped = alias(app, value, base, runtime);
        return mapped === value ? whole : `url(${JSON.stringify(mapped)})`;
      },
    )
    .replace(
      /(@import\s+)(["'])(.*?)\2/gi,
      (_whole, rule, _quote, value) =>
        rule + JSON.stringify(alias(app, value, base, runtime)),
    );
}

function element(node: Tree.ChildNode): node is Tree.Element {
  return 'tagName' in node;
}

export function prepareRuntimeDocument(
  app: Installation,
  bytes: ArrayBuffer,
  runtime: URL,
) {
  const ast = validateMarkup(new TextDecoder().decode(bytes), {
    document: true,
    initial: true,
  });
  const html = ast.childNodes.find(
    (node) => element(node) && node.tagName === 'html',
  ) as Tree.Element;
  const head = html.childNodes.find(
    (node) => element(node) && node.tagName === 'head',
  ) as Tree.Element;
  const body = html.childNodes.find(
    (node) => element(node) && node.tagName === 'body',
  ) as Tree.Element;
  const scripts: { src: string; type: string }[] = [];
  function strip(node: Tree.ParentNode) {
    node.childNodes = node.childNodes.filter((child) => {
      if (element(child) && child.tagName === 'script') {
        if (isDataScript(child.attrs.find((attr) => attr.name === 'type')?.value || ''))
          return true;
        const src = child.attrs.find((attr) => attr.name === 'src')?.value;
        const type = child.attrs.find((attr) => attr.name === 'type')?.value || '';
        if (!src) throw new Error('Missing script resource');
        const url = new URL(src, applicationURL(app, runtime));
        const original = new URL(src, app.source);
        const resource = app.resources.find(
          (item) =>
            resourceURL(app, item.path, runtime).href === url.href ||
            item.url === original.href,
        );
        if (!resource || !isExecutableScriptType(type))
          throw new Error('Script must be installed JavaScript');
        scripts.push({ src: resourceURL(app, resource.path, runtime).href, type });
        return false;
      }
      if (element(child)) {
        for (const attribute of child.attrs) {
          if (['src', 'href', 'poster'].includes(attribute.name))
            attribute.value = alias(app, attribute.value, app.source, runtime);
          if (attribute.name === 'style')
            attribute.value = css(app, attribute.value, app.source, runtime);
        }
        if (child.tagName === 'style')
          for (const text of child.childNodes)
            if ('value' in text) text.value = css(app, text.value, app.source, runtime);
        strip(child);
        if ('content' in child) strip(child.content as Tree.DocumentFragment);
      }
      return true;
    });
  }
  strip(head);
  strip(body);
  const attributes = (node: Tree.Element) =>
    node.attrs
      .filter(
        (attr) =>
          ['class', 'id', 'style', 'lang', 'dir', 'role', 'tabindex'].includes(
            attr.name,
          ) ||
          (/^(aria-|data-)/.test(attr.name) && attr.name !== 'data-host-ready'),
      )
      .map((attr) => ({
        name: attr.name,
        value:
          attr.name === 'style' ? css(app, attr.value, app.source, runtime) : attr.value,
      }));
  return {
    head: serialize(head),
    body: serialize(body),
    attributes: { html: attributes(html), body: attributes(body) },
    scripts,
    source: app.source,
    documentBase: app.documentBase || app.source,
    aliases: app.resources.map((resource) => [
      resource.url,
      resourceURL(app, resource.path, runtime).href,
    ]),
    manifestURL: manifestURL(app, runtime).href,
    serviceWorker: app.preparation.serviceWorker,
  };
}
