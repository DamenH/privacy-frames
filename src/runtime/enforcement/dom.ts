import { validateMarkup, elementAllowed } from '../../shared/policy.ts';
import type { PolicyTools } from './native.ts';
import type { ScriptPolicy } from './scripts.ts';

/** Reject context-producing markup before native parsers or insertion run. */
export function installDOMPolicy(
  tools: PolicyTools,
  rawGetAttr: typeof Element.prototype.getAttribute,
  scripts?: ScriptPolicy,
) {
  const { apply, descriptor, method, accessor, deny, fail, str } = tools;
  // The read-only relList view must never call publisher-replaceable methods
  // with its private native token list as the receiver.
  const tokenSupports = DOMTokenList.prototype.supports;
  const tokenContains = DOMTokenList.prototype.contains;
  const tokenItem = DOMTokenList.prototype.item;
  const tokenLength = descriptor(DOMTokenList.prototype, 'length')!.get!;
  const tokenValue = descriptor(DOMTokenList.prototype, 'value')!.get!;
  // Guard browser parsing before it can create nodes. Validators run with frozen JS intrinsics.
  const textHTML = (value: unknown) => {
    const text = str(value);
    validateMarkup(text);
    return text;
  };
  for (const proto of [Element.prototype, ShadowRoot.prototype]) {
    for (const key of ['innerHTML', 'outerHTML']) {
      const d = descriptor(proto, key);
      if (d?.set)
        accessor(proto, key, {
          set(value) {
            if (key === 'innerHTML' && scripts?.isScript(this)) {
              scripts.text(this, value === null ? '' : str(value));
              return;
            }
            return apply(d.set!, this, [textHTML(value)]);
          },
        });
    }
    for (const key of ['setHTML', 'setHTMLUnsafe', 'getHTML'])
      if (key !== 'getHTML') method(proto, key, deny);
  }
  const adjacent = Element.prototype.insertAdjacentHTML;
  method(
    Element.prototype,
    'insertAdjacentHTML',
    function (this: Element, position: unknown, html: unknown) {
      return apply(adjacent, this, [str(position), textHTML(html)]);
    },
  );
  method(Range.prototype, 'createContextualFragment', deny);
  method(DOMParser.prototype, 'parseFromString', deny);
  for (const key of ['parseHTML', 'parseHTMLUnsafe']) method(Document, key, deny);
  for (const key of ['createHTMLDocument', 'createDocument', 'createDocumentType'])
    method(DOMImplementation.prototype, key, deny);
  method(Element.prototype, 'attachInternals', deny);
  // Declarative/custom element constructors must not introduce hidden insertion behavior.
  if (globalThis.CustomElementRegistry)
    for (const key of ['define', 'initialize', 'upgrade'])
      method(CustomElementRegistry.prototype, key, deny);

  const create = Document.prototype.createElement,
    createNS = Document.prototype.createElementNS;
  method(
    Document.prototype,
    'createElement',
    function (this: Document, name: unknown, options?: unknown) {
      const tag = str(name);
      elementAllowed(tag);
      if (options !== undefined) fail('Customized built-in elements are not admitted');
      if (tag.toLowerCase() === 'meta' || (tag.toLowerCase() === 'script' && !scripts))
        fail('Dynamic policy/resource elements are not admitted');
      return apply(create, this, [tag]);
    },
  );
  method(
    Document.prototype,
    'createElementNS',
    function (this: Document, namespace: unknown, name: unknown, options?: unknown) {
      const ns = str(namespace),
        tag = str(name);
      elementAllowed(tag);
      if (
        ![
          'http://www.w3.org/1999/xhtml',
          'http://www.w3.org/2000/svg',
          'http://www.w3.org/1998/Math/MathML',
        ].includes(ns) ||
        options !== undefined
      )
        fail('Unsupported namespace/options');
      if (
        ['link', 'meta'].includes(tag.toLowerCase()) ||
        (tag.toLowerCase() === 'script' &&
          (!scripts || ns !== 'http://www.w3.org/1999/xhtml'))
      )
        fail('Dynamic policy/resource elements are not admitted');
      return apply(createNS, this, [ns, tag]);
    },
  );
  const nodeType = descriptor(Node.prototype, 'nodeType')!.get!;
  const first = descriptor(Node.prototype, 'firstChild')!.get!,
    next = descriptor(Node.prototype, 'nextSibling')!.get!;
  const local = descriptor(Element.prototype, 'localName')!.get!;
  const template =
    globalThis.HTMLTemplateElement &&
    descriptor(HTMLTemplateElement.prototype, 'content')!.get!;
  function inspect(node: unknown) {
    let type;
    try {
      type = apply(nodeType, node, []);
    } catch {
      return;
    }
    if (type === 1) {
      const tag = apply(local, node, []);
      elementAllowed(tag);
      if (tag.toLowerCase() === 'script') {
        if (scripts && scripts.isScript(node)) scripts.prepare(node);
        else fail('Dynamic script context is not admitted');
      } else if (['link', 'meta'].includes(tag.toLowerCase()))
        fail('Dynamic policy/resource elements are not admitted');
      if (tag === 'template' && template) inspect(apply(template, node, []));
    }
    for (let child = apply(first, node, []); child; child = apply(next, child, []))
      inspect(child);
  }
  function insertion(
    proto: object,
    key: string,
    indices?: (args: unknown[]) => number[],
  ) {
    const fn = Reflect.get(proto, key);
    if (typeof fn !== 'function') return;
    method(proto, key, function (this: Element, ...args: unknown[]) {
      for (const i of indices ? indices(args) : args.map((_, i) => i)) inspect(args[i]);
      if (scripts?.isScript(this)) scripts.prepare(this);
      return apply(fn, this, args);
    });
  }
  for (const name of ['appendChild', 'insertBefore', 'replaceChild'])
    insertion(Node.prototype, name, () => [0]);
  for (const proto of [Element.prototype, Document.prototype, DocumentFragment.prototype])
    for (const name of ['append', 'prepend', 'replaceChildren']) insertion(proto, name);
  for (const proto of [
    Element.prototype,
    CharacterData.prototype,
    DocumentType.prototype,
  ])
    for (const name of ['before', 'after', 'replaceWith']) insertion(proto, name);
  insertion(Element.prototype, 'insertAdjacentElement', () => [1]);
  insertion(Range.prototype, 'insertNode', () => [0]);
  insertion(Range.prototype, 'surroundContents', () => [0]);
  // Getter restrictions add protection if a context-producing browser path is missed.
  for (const ctor of [
    globalThis.HTMLIFrameElement,
    globalThis.HTMLFrameElement,
    globalThis.HTMLObjectElement,
    globalThis.HTMLEmbedElement,
  ])
    if (ctor) {
      for (const key of ['contentWindow', 'contentDocument', 'getSVGDocument']) {
        const d = descriptor(ctor.prototype, key);
        if (d?.get) accessor(ctor.prototype, key, { get: deny });
        else if (d?.value) method(ctor.prototype, key, deny);
      }
    }

  // Reflected properties and Attr objects must not bypass element policy.
  for (const ctor of [
    globalThis.HTMLLinkElement,
    globalThis.HTMLMetaElement,
    ...(scripts ? [] : [globalThis.HTMLScriptElement]),
  ])
    if (ctor) {
      for (const key of Object.getOwnPropertyNames(ctor.prototype)) {
        const d = descriptor(ctor.prototype, key);
        if (d?.set || key === 'relList')
          accessor(ctor.prototype, key, {
            ...(d?.set
              ? {
                  set(value) {
                    if (
                      ctor === globalThis.HTMLMetaElement &&
                      key === 'content' &&
                      apply(rawGetAttr, this, ['name']) === 'theme-color' &&
                      apply(rawGetAttr, this, ['http-equiv']) === null
                    )
                      return apply(d.set!, this, [str(value)]);
                    return deny();
                  },
                }
              : {}),
            ...(key === 'relList'
              ? {
                  get() {
                    const list = apply(d!.get!, this, []);
                    return Object.freeze({
                      supports: (token: unknown) =>
                        apply(tokenSupports, list, [str(token)]),
                      contains: (token: unknown) =>
                        apply(tokenContains, list, [str(token)]),
                      item: (index: number) => apply(tokenItem, list, [index]),
                      get length() {
                        return apply(tokenLength, list, []);
                      },
                      get value() {
                        return apply(tokenValue, list, []);
                      },
                      toString: () => apply(tokenValue, list, []),
                      add: deny,
                      remove: deny,
                      toggle: deny,
                      replace: deny,
                      [Symbol.iterator]() {
                        // Native token-list iteration can defer reads of its
                        // receiver's mutable prototype. Yield a string snapshot
                        // so no iterator retains the private native token list.
                        const length = apply(tokenLength, list, []);
                        const tokens: string[] = [];
                        for (let index = 0; index < length; index++) {
                          tokens.push(apply(tokenItem, list, [index])!);
                        }
                        return tokens[Symbol.iterator]();
                      },
                    });
                  },
                }
              : {}),
          });
      }
    }

  const ownerElement = descriptor(Attr.prototype, 'ownerElement')!.get!;
  const sensitive = (node: unknown) => {
    const tag = apply(local, node, []).toLowerCase();
    if (['link', 'meta', 'script'].includes(tag)) fail('Policy element is immutable');
  };
  for (const [proto, key] of [
    [Attr.prototype, 'value'],
    [Node.prototype, 'nodeValue'],
    [Node.prototype, 'textContent'],
  ] as const) {
    const d = descriptor(proto, key);
    if (d?.set)
      accessor(proto, key, {
        set(value) {
          if (key === 'textContent' && scripts?.isScript(this)) {
            scripts.text(this, value === null || value === undefined ? '' : str(value));
            return;
          }
          if (apply(nodeType, this, []) === 2) {
            const owner = apply(ownerElement, this, []);
            if (owner) sensitive(owner);
          }
          return apply(d.set!, this, [value]);
        },
      });
  }
  for (const key of ['setAttributeNode', 'setAttributeNodeNS']) {
    const fn = Reflect.get(Element.prototype, key);
    method(Element.prototype, key, function (this: Element, ...args: unknown[]) {
      sensitive(this);
      const attr = args[0] as Attr | undefined;
      const attrName = str(attr?.name || '').toLowerCase();
      if (['srcdoc', 'is'].includes(attrName) || attrName.startsWith('on'))
        fail('Attribute not admitted');
      return apply(fn, this, args);
    });
  }
  // NamedNodeMap setters can recover their target only after mutation. Refuse them.
  for (const key of ['setNamedItem', 'setNamedItemNS'])
    method(NamedNodeMap.prototype, key, deny);
}

/** URL setters are installed last, after storage and every parser entry point. */
export function installResourceAttributePolicy(
  tools: PolicyTools,
  mapURL: (input: unknown) => string,
  scripts?: ScriptPolicy,
) {
  const { apply, descriptor, method, fail, str } = tools;
  const local = descriptor(Element.prototype, 'localName')!.get!;
  // Policy elements can only be emitted by installation; prevent attribute-based activation.
  for (const name of ['setAttribute', 'setAttributeNS', 'toggleAttribute']) {
    const fn = Reflect.get(Element.prototype, name);
    method(Element.prototype, name, function (this: Element, ...args: unknown[]) {
      const tag = apply(local, this, []).toLowerCase();
      if (['link', 'meta'].includes(tag) || (tag === 'script' && !scripts))
        fail('Policy element is immutable');
      const nameIndex = name === 'setAttributeNS' ? 1 : 0;
      const attributeName = str(args[nameIndex]);
      args[nameIndex] = attributeName;
      const key = attributeName.toLowerCase();
      if (key === 'srcdoc' || key === 'is' || key.startsWith('on'))
        fail('Attribute not admitted');
      if (scripts?.isScript(this)) {
        if (name === 'setAttributeNS') {
          const namespace = args[0] == null ? null : str(args[0]);
          if (namespace !== null && namespace !== '')
            fail('Namespaced script attributes are not admitted');
          args[0] = namespace;
        }
        if (name === 'toggleAttribute') {
          scripts.attribute(this, key, '');
        } else {
          const valueIndex = name === 'setAttributeNS' ? 2 : 1;
          args[valueIndex] = scripts.attribute(this, key, args[valueIndex]);
        }
        return apply(fn, this, args);
      }
      if (
        name !== 'toggleAttribute' &&
        ['src', 'href', 'poster', 'xlink:href'].includes(key)
      ) {
        const index = name === 'setAttributeNS' ? 2 : 1;
        args[index] = mapURL(args[index]);
      }
      return apply(fn, this, args);
    });
  }
}
