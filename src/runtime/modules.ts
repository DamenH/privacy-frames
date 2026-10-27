import { parse } from 'es-module-lexer/js';

interface ModuleResources {
  mapURL(input: unknown): string;
  isInstalledURL(input: unknown): boolean;
}

const NativeURL = URL;
const href = Object.getOwnPropertyDescriptor(NativeURL.prototype, 'href')!.get!;
const apply = Reflect.apply;

/** Relocate literal imports to admitted resources without evaluating publisher code. */
export function relocateRuntimeModule(
  code: string,
  base: string,
  resources: ModuleResources,
): string {
  try {
    const [imports] = parse(code);
    for (const item of [...imports].reverse()) {
      if (!item.specifier || (item.type === 'dynamic' && item.glob)) continue;
      if (!/^(?:\.\.?\/|\/|https?:\/\/)/.test(item.specifier)) continue;
      const original: string = apply(href, new NativeURL(item.specifier, base), []);
      const mapped = resources.mapURL(original);
      if (!resources.isInstalledURL(mapped)) continue;
      if (mapped === item.specifier) continue;
      const start = item.type === 'dynamic' ? item.start : item.start - 1;
      const end = item.type === 'dynamic' ? item.end : item.end + 1;
      code = code.slice(0, start) + JSON.stringify(mapped) + code.slice(end);
    }
  } catch {
    // Invalid syntax and unresolved Blob-relative imports keep native behavior.
  }
  return code;
}
