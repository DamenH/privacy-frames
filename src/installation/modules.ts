import { init, parse } from 'es-module-lexer/js';

/** Recognize literal module dependencies without executing publisher code. */
export async function moduleReferences(code: string, base: string): Promise<string[]> {
  await init;
  const [imports] = parse(code);
  return imports.flatMap((item) => {
    if (!item.specifier || (item.type === 'dynamic' && item.glob)) return [];
    if (!/^(?:\.\.?\/|\/|https?:\/\/)/.test(item.specifier)) {
      throw new Error(`Bare module specifier requires an import map: ${item.specifier}`);
    }
    return [new URL(item.specifier, base).href];
  });
}

/** Rewrite captured imports only when relocation changes their resolution. */
export async function relocateModule(
  code: string,
  source: string,
  path: string,
  resources: Map<string, string>,
): Promise<string> {
  await init;
  const [imports] = parse(code);
  const virtualOrigin = 'https://installation.invalid/';
  for (const item of [...imports].reverse()) {
    if (!item.specifier || (item.type === 'dynamic' && item.glob)) continue;
    const original = new URL(item.specifier, source);
    const hash = original.hash;
    original.hash = '';
    const target = resources.get(original.href);
    if (!target) continue;
    const current = new URL(item.specifier, new URL(path, virtualOrigin)).href;
    if (current === new URL(target, virtualOrigin).href) continue;
    const parent = path.split('/').slice(0, -1);
    const parts = target.split('/');
    while (parent.length && parts[0] === parent[0]) {
      parent.shift();
      parts.shift();
    }
    const relative = '../'.repeat(parent.length) + parts.join('/');
    const value = (relative.startsWith('.') ? relative : './' + relative) + hash;
    // Replace the whole string token so either publisher quote style remains valid.
    const start = item.type === 'dynamic' ? item.start : item.start - 1;
    const end = item.type === 'dynamic' ? item.end : item.end + 1;
    code = code.slice(0, start) + JSON.stringify(value) + code.slice(end);
  }
  return code;
}
