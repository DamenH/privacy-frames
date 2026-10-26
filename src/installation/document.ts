import { parse, serialize, type DefaultTreeAdapterTypes as Tree } from 'parse5';
import { validateMarkup } from '../shared/policy.ts';

export function cssReferences(text: string, base: string): string[] {
  const urls: string[] = [];
  for (const match of text.matchAll(
    /url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)|@import\s+["']([^"']+)["']/gi,
  )) {
    const value = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (value && !/^(?:data:|blob:|#)/i.test(value)) urls.push(new URL(value, base).href);
  }
  return urls;
}
function absoluteCSS(text: string, base: string): string {
  return text
    .replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/gi, (whole, a, b, c) => {
      const value: string = a ?? b ?? c;
      return /^(?:data:|blob:|#)/i.test(value)
        ? whole
        : `url(${JSON.stringify(new URL(value, base).href)})`;
    })
    .replace(
      /(@import\s+)["']([^"']+)["']/gi,
      (_whole, prefix, value) => prefix + JSON.stringify(new URL(value, base).href),
    );
}
const element = (node: Tree.Node): node is Tree.Element => 'tagName' in node;
const attribute = (node: Tree.Element, name: string) =>
  node.attrs.find((attr) => attr.name === name)?.value;
function visit(node: Tree.Node, callback: (node: Tree.Element) => void) {
  if (element(node)) callback(node);
  if ('childNodes' in node) for (const child of node.childNodes) visit(child, callback);
  if ('content' in node) visit(node.content as Tree.DocumentFragment, callback);
}

/** Resolve public resources before runtime admission; publisher policy is never inherited. */
export function prepareDocument(text: string, documentURL: string) {
  const ast = parse(text),
    links = new Set<string>();
  const inlineScripts: { url: string; code: string }[] = [];
  let title = '',
    base = documentURL,
    baseFound = false,
    canonical = documentURL,
    manifestURL: string | null = null;
  visit(ast, (node) => {
    const href = attribute(node, 'href');
    if (node.tagName === 'base' && !baseFound && href) {
      baseFound = true;
      try {
        base = new URL(href, documentURL).href;
      } catch {
        /* Invalid first base uses the document URL. */
      }
    }
  });
  visit(ast, (node) => {
    if (node.tagName !== 'link') return;
    const rel = (attribute(node, 'rel') || '').toLowerCase().split(/\s+/),
      href = attribute(node, 'href');
    if (!href) return;
    if (rel.includes('modulepreload') || rel.includes('preload'))
      links.add(new URL(href, base).href);
    if (!manifestURL && rel.includes('manifest')) manifestURL = new URL(href, base).href;
    if (rel.includes('canonical') || rel.includes('dc:isversionof'))
      canonical = new URL(href, base).href;
  });
  const add = (value: string | undefined) => {
    if (value && !/^(?:data:|blob:|#)/i.test(value)) links.add(new URL(value, base).href);
  };
  function walk(parent: Tree.ParentNode) {
    parent.childNodes = parent.childNodes.filter((child) => {
      if (!element(child)) return true;
      const get = (name: string) => attribute(child, name);
      if (child.tagName === 'base') return false;
      if (child.tagName === 'title')
        title = child.childNodes
          .map((node) => ('value' in node ? node.value : ''))
          .join('');
      if (
        child.tagName === 'meta' &&
        !get('charset') &&
        !['viewport', 'color-scheme', 'theme-color'].includes(
          get('name')?.toLowerCase() || '',
        )
      )
        return false;
      if (child.tagName === 'link' && get('rel')?.toLowerCase() !== 'stylesheet')
        return false;
      const candidates = child.attrs.find((attr) => attr.name === 'srcset');
      if (candidates) {
        if (!get('src'))
          child.attrs.push({
            name: 'src',
            value: candidates.value.split(',')[0].trim().split(/\s+/)[0],
          });
        child.attrs = child.attrs.filter((attr) => attr !== candidates);
      }
      for (const attr of child.attrs) {
        if (['src', 'href', 'poster'].includes(attr.name) && attr.value) {
          if (child.tagName === 'a' && attr.name === 'href') {
            if (attr.value.startsWith('#')) continue;
            const target = new URL(attr.value, base),
              identity = new URL(canonical),
              fragment = target.hash;
            target.hash = '';
            identity.hash = '';
            attr.value =
              fragment && target.href === identity.href
                ? fragment
                : new URL(attr.value, base).href;
          } else if (!/^(?:data:|blob:|#)/i.test(attr.value))
            attr.value = new URL(attr.value, base).href;
        }
        if (attr.name === 'style') {
          attr.value = absoluteCSS(attr.value, base);
          for (const url of cssReferences(attr.value, base)) add(url);
        }
      }
      if (child.tagName === 'script') {
        if (!get('src')) {
          const type = get('type') || '';
          if (!['', 'module', 'text/javascript', 'application/javascript'].includes(type))
            throw new Error('Unsupported inline script type');
          const url = new URL(`__pf_inline_${crypto.randomUUID()}.js`, base).href;
          const code = child.childNodes
            .map((node) => ('value' in node ? node.value : ''))
            .join('');
          inlineScripts.push({ url, code });
          child.childNodes = [];
          child.attrs.push({ name: 'src', value: url });
        } else add(get('src'));
      }
      if (child.tagName === 'link') add(get('href'));
      if (['img', 'audio', 'video', 'source', 'input'].includes(child.tagName)) {
        add(get('src'));
        add(get('poster'));
      }
      if (child.tagName === 'style')
        for (const node of child.childNodes)
          if ('value' in node) {
            node.value = absoluteCSS(node.value, base);
            for (const url of cssReferences(node.value, base)) add(url);
          }
      walk(child);
      if ('content' in child) walk(child.content as Tree.DocumentFragment);
      return true;
    });
  }
  walk(ast);
  const html = serialize(ast);
  validateMarkup(html, { document: true, initial: true });
  return { html, title, links: [...links], manifestURL, inlineScripts };
}
