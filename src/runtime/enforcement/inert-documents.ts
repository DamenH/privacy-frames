import { strings, internalArray, internalRecord } from '../../shared/primordials.ts';
import { elementAllowed } from '../../shared/policy.ts';
import type { TrustedPolicy } from '../trusted/client.ts';
import type { PolicyTools } from './native.ts';
import { createNativeMarkupValidator } from './native-markup.ts';

/** Native viewless documents are DOM construction containers, never execution realms. */
export function installInertDocuments(tools: PolicyTools, policy: TrustedPolicy) {
  const { apply, descriptor, method, accessor, fail, str } = tools;
  const nativeMarkup = createNativeMarkupValidator(fail);
  const documents = new WeakSet<object>();
  const nodeType = descriptor(Node.prototype, 'nodeType')!.get!;
  const owner = descriptor(Node.prototype, 'ownerDocument')!.get!;
  const view = descriptor(Document.prototype, 'defaultView')!.get!;
  const local = descriptor(Element.prototype, 'localName')!.get!;
  const namespace = descriptor(Element.prototype, 'namespaceURI')!.get!;
  const names = Element.prototype.getAttributeNames;
  const first = descriptor(Node.prototype, 'firstChild')!.get!;
  const next = descriptor(Node.prototype, 'nextSibling')!.get!;
  const template = descriptor(HTMLTemplateElement.prototype, 'content')!.get!;
  const create = DOMImplementation.prototype.createHTMLDocument;
  const createXML = DOMImplementation.prototype.createDocument;
  const parse = DOMParser.prototype.parseFromString;
  const html = 'http://www.w3.org/1999/xhtml';

  function register<T extends object>(value: T): T {
    if (apply(view, value, []) !== null) fail('DOM construction must be viewless');
    documents.add(value);
    return value;
  }
  function documentOf(value: unknown): object | undefined {
    try {
      if (apply(nodeType, value, []) === 9)
        return value !== null && typeof value === 'object' ? value : undefined;
      return apply(owner, value, []);
    } catch {
      return;
    }
  }
  function owns(value: unknown): boolean {
    const document = documentOf(value);
    return !!document && documents.has(document) && apply(view, document, []) === null;
  }
  function track(value: Node): void {
    if (apply(nodeType, value, []) === 9) {
      register(value);
      return;
    }
    try {
      const content: DocumentFragment = apply(template, value, []);
      register(apply(owner, content, []));
    } catch {
      /* Other native node kinds have no template owner document. */
    }
  }
  function inspect(value: unknown, allowBase = false): void {
    let type: number;
    try {
      type = apply(nodeType, value, []);
    } catch {
      return;
    }
    if (type === 7) fail('Processing instructions are not admitted');
    if (type === 1) {
      const tag: string = apply(local, value, []),
        ns: string = apply(namespace, value, []);
      if (!(allowBase && tag === 'base' && ns === html)) elementAllowed(tag);
      if (['script', 'link', 'meta'].includes(strings.toLowerCase(tag)))
        fail('DOM construction must remain passive');
      const attributes: string[] = internalArray(apply(names, value, []));
      if (
        attributes.some(
          (name) =>
            /^on/i.test(name) ||
            ['srcdoc', 'is', 'manifest'].includes(strings.toLowerCase(name)),
        )
      )
        fail('Active construction attributes are not admitted');
      if (tag === 'template' && ns === html)
        inspect(apply(template, value, []), allowBase);
    }
    for (let child = apply(first, value, []); child; child = apply(next, child, []))
      inspect(child, allowBase);
  }

  function rejectInstructions(value: unknown): void {
    let type: number;
    try {
      type = apply(nodeType, value, []);
    } catch {
      return;
    }
    if (type === 7) fail('Processing instructions are not admitted');
    if (
      type === 1 &&
      apply(local, value, []) === 'template' &&
      apply(namespace, value, []) === html
    )
      rejectInstructions(apply(template, value, []));
    for (let child = apply(first, value, []); child; child = apply(next, child, []))
      rejectInstructions(child);
  }

  method(
    DOMImplementation.prototype,
    'createHTMLDocument',
    function (this: DOMImplementation, ...args: unknown[]) {
      args = internalArray(args);
      return register(apply(create, this, args));
    },
  );
  method(
    DOMImplementation.prototype,
    'createDocument',
    function (
      this: DOMImplementation,
      namespace: unknown,
      name: unknown,
      doctype?: unknown,
    ) {
      const ns = namespace == null ? null : str(namespace);
      const qualifiedName = str(name);
      if (doctype != null) fail('XML construction declarations are not admitted');
      const created: XMLDocument = register(
        apply(createXML, this, [ns, qualifiedName, null]),
      );
      inspect(created);
      return created;
    },
  );
  method(
    DOMParser.prototype,
    'parseFromString',
    function (this: DOMParser, input: unknown, type: unknown) {
      const source = str(input),
        kind = str(type);
      if (
        ![
          'text/html',
          'image/svg+xml',
          'application/xml',
          'text/xml',
          'application/xhtml+xml',
        ].includes(kind)
      )
        fail('Unsupported DOM construction type');
      if (
        kind !== 'text/html' &&
        (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source) ||
          /<\?(?!xml(?:\s|\?>))/i.test(source))
      )
        fail('XML construction declarations are not admitted');
      policy.validateMarkup(source, kind === 'text/html');
      const parsed: Document = register(apply(parse, this, [source, kind]));
      nativeMarkup.inspect(parsed);
      return parsed;
    },
  );
  accessor(
    HTMLTemplateElement.prototype,
    'content',
    internalRecord({
      get(this: HTMLTemplateElement): DocumentFragment {
        const content: DocumentFragment = apply(template, this, []);
        register(apply(owner, content, []));
        return content;
      },
    }),
  );
  return internalRecord({ owns, inspect, track, rejectInstructions });
}
