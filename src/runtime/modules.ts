import {
  internalArray,
  internalRecord,
  strings,
  ownDescriptor,
} from '../shared/primordials.ts';
import {
  children,
  node,
  nodes,
  parseProgram,
  record,
  type SyntaxNode,
} from '../shared/module-source.ts';
import { Parser } from 'acorn';
import importPhases from 'acorn-import-phases';

interface ModuleResources {
  mapURL(input: unknown): string;
  isInstalledURL(input: unknown): boolean;
}

const NativeURL = URL;
const href = ownDescriptor(NativeURL.prototype, 'href')!.get!;
const apply = Reflect.apply;
const stringify = JSON.stringify;
const ModuleParser = Parser.extend(importPhases());
const parseModule = ModuleParser.parse.bind(ModuleParser);

function specifier(source: SyntaxNode): string | undefined {
  if (source.type === 'Literal' && typeof source.value === 'string') return source.value;
  if (source.type !== 'TemplateLiteral' || nodes(source.expressions).length) return;
  const quasis = nodes(source.quasis);
  const cooked = quasis.length === 1 ? record(quasis[0].value)?.cooked : undefined;
  return typeof cooked === 'string' ? cooked : undefined;
}

/** Relocate literal imports to admitted resources without evaluating publisher code. */
export function relocateRuntimeModule(
  code: string,
  base: string,
  resources: ModuleResources,
): string {
  try {
    const imports = internalArray<{ start: number; end: number; specifier: string }>();
    const visit = (current: SyntaxNode): void => {
      if (
        current.type === 'ImportDeclaration' ||
        current.type === 'ExportNamedDeclaration' ||
        current.type === 'ExportAllDeclaration' ||
        current.type === 'ImportExpression'
      ) {
        const source = node(current.source);
        const value = source && specifier(source);
        if (source && value)
          imports.push(
            internalRecord({ start: source.start, end: source.end, specifier: value }),
          );
      }
      for (const child of children(current)) visit(child);
    };
    visit(parseProgram(code, parseModule));
    for (const item of imports.sort((left, right) => right.start - left.start)) {
      if (!/^(?:\.\.?\/|\/|https?:\/\/)/.test(item.specifier)) continue;
      const original: string = apply(href, new NativeURL(item.specifier, base), []);
      const mapped = resources.mapURL(original);
      if (!resources.isInstalledURL(mapped)) continue;
      if (mapped === item.specifier) continue;
      code =
        strings.slice(code, 0, item.start) +
        stringify(mapped) +
        strings.slice(code, item.end);
    }
  } catch {
    // Invalid syntax and unresolved Blob-relative imports keep native behavior.
  }
  return code;
}
