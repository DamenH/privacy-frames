import { ident, parse, string, walk, type CssNode } from 'css-tree';

type CSSContext = 'stylesheet' | 'declarationList';
interface Reference {
  start: number;
  end: number;
  url: string;
  replacement: string;
}

/** Collect resource-bearing syntax without interpreting comments or quoted content. */
function references(text: string, base: string, context: CSSContext): Reference[] {
  const ast = parse(text, { context, positions: true, parseCustomProperty: true });
  const result: Reference[] = [];
  function add(node: CssNode, value: string, kind: 'url' | 'string') {
    if (!node.loc || !value || /^(?:data:|blob:|#)/i.test(value)) return;
    let url: string;
    try {
      url = new URL(value, base).href;
    } catch {
      return; // An invalid CSS URL must not discard later valid declarations.
    }
    const encoded = string.encode(url);
    result.push({
      start: node.loc.start.offset,
      end: node.loc.end.offset,
      url,
      replacement: kind === 'url' ? 'url(' + encoded + ')' : encoded,
    });
  }
  walk(ast, function (node) {
    if (node.type === 'Atrule' && ident.decode(node.name).toLowerCase() === 'import') {
      let prelude: CssNode | null = node.prelude;
      // Escaped at-rule names use the parser's generic prelude grammar initially.
      if (prelude?.type === 'Raw' && prelude.loc) {
        try {
          prelude = parse(prelude.value, {
            context: 'atrulePrelude',
            atrule: 'import',
            positions: true,
            offset: prelude.loc.start.offset,
          });
        } catch {
          return;
        }
      }
      if (prelude?.type === 'AtrulePrelude') {
        const first = prelude.children.first;
        if (first?.type === 'String') add(first, first.value, 'string');
        else if (first?.type === 'Url') add(first, first.value, 'url');
      }
    }
    // A URL in a supports condition or namespace declaration does not fetch a resource.
    if (node.type === 'AtrulePrelude') return this.skip;
    if (!this.declaration) return;
    if (node.type === 'Url') add(node, node.value, 'url');
    else if (
      node.type === 'Function' &&
      ident.decode(node.name).toLowerCase() === 'url' &&
      node.children.size === 1 &&
      node.children.first?.type === 'String'
    )
      add(node, node.children.first.value, 'url');
  });
  return result;
}

export function cssReferences(
  text: string,
  base: string,
  context: CSSContext = 'stylesheet',
): string[] {
  return references(text, base, context).map((reference) => reference.url);
}

/** Replace only parsed resource spans, preserving all other source text. */
export function prepareCSS(
  text: string,
  base: string,
  context: CSSContext = 'stylesheet',
): { text: string; urls: string[] } {
  const found = references(text, base, context);
  for (const reference of [...found].sort((a, b) => b.start - a.start))
    text =
      text.slice(0, reference.start) + reference.replacement + text.slice(reference.end);
  return { text, urls: found.map((reference) => reference.url) };
}
