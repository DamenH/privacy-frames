import { strings, internalRecord } from './primordials.ts';
/** Native browsing targets stay in the current prepared browsing context. */
export function isNavigationTarget(name: string): boolean {
  return ['target', 'formtarget'].includes(
    strings.toLowerCase(strings.split(name, ':').at(-1)!),
  );
}

export function isUnsafeTargetMutation(name: string, value: string): boolean {
  const local = strings.toLowerCase(strings.split(name, ':').at(-1)!);
  if (local === 'show' && strings.toLowerCase(strings.trim(value)) === 'new') return true;
  return (
    local === 'attributename' &&
    ['target', 'formtarget', 'attributename', 'show'].includes(
      strings.split(strings.toLowerCase(strings.trim(value)), ':').at(-1)!,
    )
  );
}

/** Normalize a parser-owned attribute list before it can become live DOM. */
export function normalizeNavigationAttributes(
  tag: string,
  attributes: Array<{ name: string; value: string }>,
): void {
  for (const item of attributes) {
    if (isUnsafeTargetMutation(item.name, item.value))
      throw new Error('Declarative browsing-target mutation is not admitted');
    if (isNavigationTarget(item.name)) item.value = '_self';
  }
  const name = ['a', 'area', 'form'].includes(strings.toLowerCase(tag))
    ? 'target'
    : ['button', 'input'].includes(strings.toLowerCase(tag))
      ? 'formtarget'
      : undefined;
  if (name && !attributes.some((item) => item.name === name))
    attributes.push(internalRecord({ name, value: '_self' }));
}
