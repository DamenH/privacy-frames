import { strings, internalRecord } from '../../shared/primordials.ts';
import type { PolicyTools } from './native.ts';

/** Dynamic resource links have a bounded role; connection hints stay prohibited. */
export function createResourceElementPolicy(
  tools: PolicyTools,
  mapURL: (input: unknown) => string,
) {
  const { apply, descriptor, fail, str } = tools;
  const local = descriptor(Element.prototype, 'localName')!.get!;
  const get = Element.prototype.getAttribute;
  const set = Element.prototype.setAttribute;
  const namespace = descriptor(Node.prototype, 'namespaceURI')?.get;
  const namespaceElement = descriptor(Element.prototype, 'namespaceURI')?.get;
  const readNamespace = namespace || namespaceElement;
  if (!readNamespace) throw new Error('Native namespace access unavailable');
  const attributes = Element.prototype.getAttributeNames;

  function isLink(node: unknown): node is HTMLLinkElement {
    try {
      return (
        apply(local, node, []) === 'link' &&
        apply(readNamespace!, node, []) === 'http://www.w3.org/1999/xhtml'
      );
    } catch {
      return false;
    }
  }

  function check(node: HTMLLinkElement, key?: string, value?: string) {
    const read = (name: string): string =>
      key === name ? value || '' : apply(get, node, [name]) || '';
    const rel = strings.toLowerCase(strings.trim(read('rel')));
    if (rel && rel !== 'stylesheet' && rel !== 'preload')
      fail('Dynamic link relation is not admitted');
    const destination = strings.toLowerCase(strings.trim(read('as')));
    if (destination && !['style', 'font', 'image', 'script'].includes(destination))
      fail('Dynamic link destination is not admitted');
    if (read('imagesrcset')) fail('Dynamic link image sets are not admitted');
    if (
      (key !== undefined && strings.startsWith(key, 'on')) ||
      key === 'is' ||
      (key !== undefined && strings.includes(key, ':'))
    )
      fail('Dynamic link attribute is not admitted');
  }

  return internalRecord({
    isLink,
    attribute(node: unknown, name: string, value: unknown): string | undefined {
      if (!isLink(node)) return;
      const key = strings.toLowerCase(name);
      const text = str(value);
      check(node, key, text);
      return key === 'href' ? mapURL(text) : text;
    },
    prepare(node: unknown): boolean {
      if (!isLink(node)) return false;
      check(node);
      for (const name of apply(attributes, node, []))
        if (strings.startsWith(strings.toLowerCase(name), 'on'))
          fail('Dynamic link event attributes are not admitted');
      const href: string | null = apply(get, node, ['href']);
      if (href !== null) apply(set, node, ['href', mapURL(href)]);
      return true;
    },
  });
}
