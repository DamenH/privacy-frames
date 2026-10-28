import { strings, internalSet, internalRecord } from '../../shared/primordials.ts';
import {
  isNavigationTarget,
  isUnsafeTargetMutation,
} from '../../shared/navigation-targets.ts';
import type { PolicyTools } from './native.ts';

/** Remove native target-based context creation before publisher code can run. */
export function installNavigationTargets(tools: PolicyTools) {
  const { apply, descriptor, accessor, fail, str } = tools;
  const local = descriptor(Element.prototype, 'localName')!.get!;
  const set = Element.prototype.setAttribute;
  const get = Element.prototype.getAttribute;
  const animated = new WeakMap<object, boolean>();
  const nodeType = descriptor(Node.prototype, 'nodeType')!.get!;
  const first = descriptor(Node.prototype, 'firstChild')!.get!;
  const next = descriptor(Node.prototype, 'nextSibling')!.get!;
  const template = descriptor(HTMLTemplateElement.prototype, 'content')!.get!;

  function attribute(name: string, value: unknown): string {
    const text = str(value);
    if (isUnsafeTargetMutation(name, text))
      fail('Declarative browsing-target mutation is not admitted');
    return isNavigationTarget(name) ? '_self' : text;
  }
  function prepare(node: Element) {
    const tag: string = apply(local, node, []);
    if (['a', 'area', 'form'].includes(strings.toLowerCase(tag)))
      apply(set, node, ['target', '_self']);
    if (['button', 'input'].includes(strings.toLowerCase(tag)))
      apply(set, node, ['formtarget', '_self']);
    const animation =
      apply(get, node, ['attributeName']) ?? apply(get, node, ['attributename']);
    if (animation !== null && isUnsafeTargetMutation('attributeName', animation))
      fail('Declarative browsing-target mutation is not admitted');
  }

  function tree(value: Node) {
    if (apply(nodeType, value, []) === 1) {
      prepare(value as Element);
      if (apply(local, value, []) === 'template') tree(apply(template, value, []));
    }
    for (let child = apply(first, value, []); child; child = apply(next, child, []))
      tree(child);
  }

  for (const ctor of [
    globalThis.HTMLAnchorElement,
    globalThis.HTMLAreaElement,
    globalThis.HTMLFormElement,
    globalThis.HTMLBaseElement,
    globalThis.HTMLButtonElement,
    globalThis.HTMLInputElement,
  ]) {
    if (!ctor) continue;
    const key =
      ctor === globalThis.HTMLButtonElement || ctor === globalThis.HTMLInputElement
        ? 'formTarget'
        : 'target';
    const d = descriptor(ctor.prototype, key);
    if (d?.set)
      accessor(
        ctor.prototype,
        key,
        internalRecord({
          set(this: Element, value: unknown) {
            str(value);
            return apply(d.set!, this, ['_self']);
          },
        }),
      );
  }

  // Animated strings have no owner pointer. Register values returned by captured
  // SVG getters; unknown (including unregistered foreign-realm) receivers fail.
  if (globalThis.SVGAnimatedString) {
    const base = descriptor(SVGAnimatedString.prototype, 'baseVal')!;
    const target =
      globalThis.SVGAElement && descriptor(SVGAElement.prototype, 'target')?.get;
    const seen = internalSet<object>();
    for (const name of Object.getOwnPropertyNames(globalThis)) {
      if (!/^SVG.*Element$/.test(name)) continue;
      const ctor = Reflect.get(globalThis, name);
      if (typeof ctor !== 'function' || !ctor.prototype || seen.has(ctor.prototype))
        continue;
      seen.add(ctor.prototype);
      for (const key of Object.getOwnPropertyNames(ctor.prototype)) {
        const d = descriptor(ctor.prototype, key);
        if (!d?.get || !d.configurable) continue;
        accessor(
          ctor.prototype,
          key,
          internalRecord({
            get(this: Element) {
              const value = apply(d.get!, this, []);
              try {
                apply(base.get!, value, []);
              } catch {
                return value;
              }
              let isTarget = false;
              if (target && key === 'target') {
                try {
                  isTarget = apply(target, this, []) === value;
                } catch {
                  /* Other SVG target getters. */
                }
              }
              animated.set(value, isTarget);
              return value;
            },
          }),
        );
      }
    }
    accessor(
      SVGAnimatedString.prototype,
      'baseVal',
      internalRecord({
        set(this: SVGAnimatedString, value: unknown) {
          if (!animated.has(this)) fail('Unregistered animated-string mutation');
          const text = str(value);
          return apply(base.set!, this, [animated.get(this) ? '_self' : text]);
        },
      }),
    );
  }

  return internalRecord({ prepare, attribute, tree });
}
