import type { RealmCallable, RealmValue } from '../realms/types.ts';

/** Milestone-one guest bridge. It is not yet a production browser profile. */
export function installDOMContract(host: RealmCallable): void {
  const identities = new Map<number, object>();
  const handles = new WeakMap<object, number>();
  type Packet = {
    ok: boolean;
    value?: unknown;
    error?: { name: string; message: string };
  };
  function invoke(operation: string, args: unknown[], callback?: RealmCallable): unknown {
    const encoded = host(operation, JSON.stringify(args), callback);
    if (typeof encoded !== 'string') throw new TypeError('Invalid bridge response');
    const packet: Packet = JSON.parse(encoded);
    if (!packet.ok) {
      const error = new Error(packet.error?.message || 'Browser operation refused');
      error.name = packet.error?.name || 'Error';
      throw error;
    }
    return packet.value;
  }
  function handle(value: object): number {
    const id = handles.get(value);
    if (id === undefined) throw new TypeError('Unknown browser handle');
    return id;
  }
  function reference(id: unknown): object | null {
    if (id === null) return null;
    if (typeof id !== 'number') throw new TypeError('Invalid browser handle');
    const existing = identities.get(id);
    if (existing) return existing;
    const element = new ElementFacade(id);
    identities.set(id, element);
    return element;
  }
  class ElementFacade {
    constructor(id: number) {
      handles.set(this, id);
    }
    get ownerDocument() {
      return documentFacade;
    }
    get textContent() {
      return invoke('get', [handle(this), 'textContent']);
    }
    set textContent(value: unknown) {
      invoke('set', [handle(this), 'textContent', String(value)]);
    }
    get checked() {
      return invoke('get', [handle(this), 'checked']);
    }
    get type() {
      return invoke('get', [handle(this), 'type']);
    }
    set type(value: unknown) {
      invoke('set', [handle(this), 'type', String(value)]);
    }
    get style() {
      const id = handle(this);
      return new Proxy(
        {},
        {
          set(_target, key, value) {
            invoke('style', [id, String(key), String(value)]);
            return true;
          },
        },
      );
    }
    appendChild(child: object) {
      invoke('append', [handle(this), handle(child)]);
      return child;
    }
    getBoundingClientRect() {
      return invoke('rect', [handle(this)]);
    }
    addEventListener(
      type: string,
      callback: (this: ElementFacade, event: EventFacade) => void,
    ) {
      const target = this;
      invoke('listen', [handle(this), String(type)], (...values: RealmValue[]) => {
        if (typeof values[0] !== 'string') throw new TypeError('Invalid event');
        const data: { id: number; target: number; type: string } = JSON.parse(values[0]);
        callback.call(target, new EventFacade(data));
        return undefined;
      });
    }
  }
  class EventFacade {
    private data: { id: number; target: number; type: string };
    constructor(data: { id: number; target: number; type: string }) {
      this.data = data;
    }
    get type() {
      return this.data.type;
    }
    get target() {
      return reference(this.data.target);
    }
    get view() {
      return globalThis;
    }
    preventDefault() {
      invoke('prevent', [this.data.id]);
    }
  }
  class DocumentFacade {
    get body() {
      return reference(invoke('body', []));
    }
    get defaultView() {
      return globalThis;
    }
    createElement(name: string) {
      return reference(invoke('create', [String(name)]));
    }
    querySelector(selector: string) {
      return reference(invoke('query', [String(selector)]));
    }
  }
  let documentFacade: object = new DocumentFacade();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  if (descriptor && !descriptor.configurable) {
    const original: unknown = Reflect.get(globalThis, 'document');
    if (!original || typeof original !== 'object')
      throw new Error('Invalid native document');
    Object.setPrototypeOf(original, documentFacade);
    documentFacade = original;
  } else
    Object.defineProperty(globalThis, 'document', {
      value: documentFacade,
      configurable: true,
    });
  identities.set(1, documentFacade);
  handles.set(documentFacade, 1);
  Object.defineProperty(globalThis, 'Element', {
    value: ElementFacade,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'Document', {
    value: DocumentFacade,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'Event', { value: EventFacade, configurable: true });
  if (!Object.getOwnPropertyDescriptor(globalThis, 'window'))
    Object.defineProperty(globalThis, 'window', {
      value: globalThis,
      configurable: true,
    });
}

/** Trusted host implementation; only explicit operations can invoke browser APIs. */
export function createDOMContract(root: HTMLElement) {
  const nodes = new Map<number, Element>([[2, root]]);
  const ids = new WeakMap<Element, number>([[root, 2]]);
  const events = new Map<number, Event>();
  const listeners: { node: Element; type: string; listener: EventListener }[] = [];
  let next = 3;
  let active = true;
  function identify(node: Element | null): number | null {
    if (!node) return null;
    let id = ids.get(node);
    if (id === undefined) {
      id = next++;
      ids.set(node, id);
      nodes.set(id, node);
    }
    return id;
  }
  function element(id: unknown): Element {
    if (typeof id !== 'number') throw new TypeError('Invalid node handle');
    const node = nodes.get(id);
    if (!node) throw new Error('Unknown node handle');
    return node;
  }
  const call: RealmCallable = (operation, encoded, callback) => {
    try {
      if (!active) throw new Error('Bridge authority was revoked');
      if (typeof operation !== 'string' || typeof encoded !== 'string')
        throw new TypeError('Invalid browser operation');
      const args: unknown = JSON.parse(encoded);
      if (!Array.isArray(args)) throw new TypeError('Invalid browser arguments');
      const string = (value: unknown) => {
        if (typeof value !== 'string') throw new TypeError('Expected a string');
        return value;
      };
      let value: unknown;
      switch (operation) {
        case 'body':
          value = 2;
          break;
        case 'create': {
          const name = string(args[0]);
          if (!['div', 'span', 'button', 'input'].includes(name))
            throw new Error('Element outside contract');
          value = identify(document.createElement(name));
          break;
        }
        case 'query':
          value = identify(root.querySelector(string(args[0])));
          break;
        case 'append':
          value = identify(element(args[0]).appendChild(element(args[1])));
          break;
        case 'get': {
          const node = element(args[0]),
            key = string(args[1]);
          if (key === 'textContent') value = node.textContent;
          else if (node instanceof HTMLInputElement && key === 'checked')
            value = node.checked;
          else if (node instanceof HTMLInputElement && key === 'type') value = node.type;
          else throw new Error('Property outside contract');
          break;
        }
        case 'set': {
          const node = element(args[0]),
            key = string(args[1]),
            input = string(args[2]);
          if (key === 'textContent') node.textContent = input;
          else if (node instanceof HTMLInputElement && key === 'type') node.type = input;
          else throw new Error('Property outside contract');
          break;
        }
        case 'style': {
          const node = element(args[0]),
            key = string(args[1]),
            input = string(args[2]);
          if (
            !(node instanceof HTMLElement) ||
            !['width', 'height', 'display', 'color'].includes(key)
          )
            throw new Error('Style outside contract');
          node.style.setProperty(key, input);
          break;
        }
        case 'rect': {
          const rect = element(args[0]).getBoundingClientRect();
          value = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
          break;
        }
        case 'listen': {
          const node = element(args[0]),
            type = string(args[1]);
          if (typeof callback !== 'function') throw new TypeError('Invalid callback');
          if (!['click', 'input', 'change'].includes(type))
            throw new Error('Event outside contract');
          const listener = (event: Event) => {
            if (!active) return;
            const id = next++;
            events.set(id, event);
            callback(JSON.stringify({ id, target: identify(node), type: event.type }));
          };
          node.addEventListener(type, listener);
          listeners.push({ node, type, listener });
          break;
        }
        case 'prevent': {
          if (typeof args[0] !== 'number') throw new TypeError('Invalid event handle');
          const event = events.get(args[0]);
          if (!event) throw new Error('Unknown event handle');
          event.preventDefault();
          break;
        }
        default:
          throw new Error('Operation outside contract');
      }
      return JSON.stringify({ ok: true, value });
    } catch (error) {
      return JSON.stringify({
        ok: false,
        error: {
          name: error instanceof Error ? error.name : 'Error',
          message: error instanceof Error ? error.message : 'Browser operation failed',
        },
      });
    }
  };
  return {
    call,
    revoke() {
      active = false;
      for (const { node, type, listener } of listeners)
        node.removeEventListener(type, listener);
      listeners.length = 0;
      events.clear();
      nodes.clear();
    },
  };
}
