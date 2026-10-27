import { isDataScript, isExecutableScriptType } from '../../shared/policy.ts';
import { relocateRuntimeModule } from '../modules.ts';
import type { PolicyTools } from './native.ts';

export interface ScriptPolicy {
  isScript(node: unknown): node is HTMLScriptElement;
  prepare(node: HTMLScriptElement): void;
  attribute(node: HTMLScriptElement, name: string, value: unknown): string;
  text(node: HTMLScriptElement, value: string): void;
}

interface ScriptResources {
  nonce: string;
  mapURL(input: unknown): string;
  isInstalledURL(input: unknown): boolean;
}

const stringProperties = new Set([
  'charset',
  'crossOrigin',
  'integrity',
  'referrerPolicy',
  'fetchPriority',
  'blocking',
]);
const booleanProperties = new Set(['async', 'defer', 'noModule']);
const attributes = new Set([
  'src',
  'type',
  'charset',
  'crossorigin',
  'integrity',
  'referrerpolicy',
  'fetchpriority',
  'async',
  'defer',
  'nomodule',
  'nonce',
  'id',
  'class',
  'title',
  'blocking',
]);

/** Admit executable scripts only after the owning realm's confinement is installed. */
export function installScriptPolicy(
  tools: PolicyTools,
  resources: ScriptResources,
): ScriptPolicy {
  const { apply, descriptor, accessor, str, fail } = tools;
  const NativeURL = URL;
  const urlHref = descriptor(NativeURL.prototype, 'href')!.get!;
  const urlOrigin = descriptor(NativeURL.prototype, 'origin')!.get!;
  const urlProtocol = descriptor(NativeURL.prototype, 'protocol')!.get!;
  const baseURI = descriptor(Node.prototype, 'baseURI')!.get!;
  const prototype = HTMLScriptElement.prototype;
  const local = descriptor(Element.prototype, 'localName')!.get!;
  const namespace = descriptor(Element.prototype, 'namespaceURI')!.get!;
  const getAttribute = Element.prototype.getAttribute;
  const setAttribute = Element.prototype.setAttribute;
  const nativeText = descriptor(prototype, 'text')!.set!;
  const nonce = resources.nonce;
  if (!nonce || !/^[A-Za-z0-9+/_=-]+$/.test(nonce))
    throw new Error('Dynamic script policy requires a document nonce');

  function isScript(node: unknown): node is HTMLScriptElement {
    try {
      return (
        apply(local, node, []) === 'script' &&
        apply(namespace, node, []) === 'http://www.w3.org/1999/xhtml'
      );
    } catch {
      return false;
    }
  }

  function scriptType(input: unknown): string {
    const value = str(input).trim().toLowerCase();
    if (!isExecutableScriptType(value) && !isDataScript(value))
      fail('Unsupported script type');
    return value;
  }

  function sourceURL(input: unknown): string {
    const mapped = resources.mapURL(input);
    const url = new NativeURL(mapped, apply(baseURI, document, []));
    const href: string = apply(urlHref, url, []);
    if (
      !resources.isInstalledURL(href) &&
      !(
        apply(urlProtocol, url, []) === 'blob:' &&
        apply(urlOrigin, url, []) === location.origin
      )
    )
      fail('Script resource is not installed');
    return href;
  }

  function prepare(node: HTMLScriptElement): void {
    const type = scriptType(apply(getAttribute, node, ['type']) || '');
    const source = apply(getAttribute, node, ['src']);
    if (isDataScript(type)) {
      if (source !== null) fail('Data scripts must be inline');
      apply(setAttribute, node, ['nonce', nonce]);
      return;
    }
    if (source !== null) sourceURL(source);
    // The nonce permits synchronous native inline execution in this already
    // confined realm. Script type and context creation remain separately gated.
    apply(setAttribute, node, ['nonce', nonce]);
  }

  function scriptText(node: HTMLScriptElement, text: string): string {
    if (isDataScript(scriptType(apply(getAttribute, node, ['type']) || ''))) return text;
    return relocateRuntimeModule(text, apply(baseURI, document, []), resources);
  }

  function attribute(node: HTMLScriptElement, name: string, input: unknown): string {
    const key = name.toLowerCase();
    if (!attributes.has(key) && !/^(?:data-|aria-)/.test(key))
      fail('Script attribute is not admitted');
    const value = str(input);
    if (key === 'type') {
      const type = scriptType(value);
      if (isDataScript(type) && apply(getAttribute, node, ['src']) !== null)
        fail('Data scripts must be inline');
    }
    if (key === 'src') {
      const type = scriptType(apply(getAttribute, node, ['type']) || '');
      if (isDataScript(type)) fail('Data scripts must be inline');
      prepare(node);
      return sourceURL(value);
    }
    prepare(node);
    return key === 'nonce' ? nonce : value;
  }

  for (const key of Object.getOwnPropertyNames(prototype)) {
    const property = descriptor(prototype, key);
    if (!property?.set) continue;
    const setter = property.set;
    accessor(prototype, key, {
      set(this: HTMLScriptElement, value: unknown) {
        if (key === 'src') return apply(setter, this, [attribute(this, 'src', value)]);
        if (key === 'type') {
          const text = str(value);
          const type = scriptType(text);
          if (isDataScript(type) && apply(getAttribute, this, ['src']) !== null)
            fail('Data scripts must be inline');
          prepare(this);
          return apply(setter, this, [text]);
        }
        if (['text', 'textContent', 'innerText'].includes(key)) {
          prepare(this);
          const empty =
            (key === 'textContent' && value == null) ||
            (key === 'innerText' && value === null);
          const text = empty ? '' : str(value);
          return apply(setter, this, [scriptText(this, text)]);
        }
        if (stringProperties.has(key)) {
          prepare(this);
          return apply(setter, this, [str(value)]);
        }
        if (booleanProperties.has(key)) {
          prepare(this);
          return apply(setter, this, [value]);
        }
        return fail('Script property is not admitted');
      },
    });
  }

  return Object.freeze({
    isScript,
    prepare,
    attribute,
    text(node: HTMLScriptElement, value: string) {
      prepare(node);
      apply(nativeText, node, [scriptText(node, value)]);
    },
  });
}
