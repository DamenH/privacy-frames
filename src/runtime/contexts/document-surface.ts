import { ownDescriptor, internalRecord } from '../../shared/primordials.ts';
export interface PopupContextOptions {
  name: string;
  noopener: boolean;
  noreferrer: boolean;
}
export interface DocumentSurface {
  carrier: 'frame' | 'popup';
  popup?: PopupContextOptions;
}
function field(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid document surface');
  const own = ownDescriptor(value, key);
  if (own && !('value' in own))
    throw new Error('Document surface requires data properties');
  return own?.value;
}
/** Requests may omit the frame default; persisted grants are always explicit. */
export function parseDocumentSurface(
  value: unknown,
  defaultFrame = false,
): DocumentSurface {
  const carrier = field(value, 'carrier');
  const popup = field(value, 'popup');
  if (carrier === 'frame' || (carrier === undefined && defaultFrame)) {
    if (popup !== undefined) throw new Error('Frame context cannot carry popup options');
    return internalRecord({ carrier: 'frame' });
  }
  if (carrier !== 'popup') throw new Error('Invalid document carrier');
  const name = field(popup, 'name');
  const noopener = field(popup, 'noopener');
  const noreferrer = field(popup, 'noreferrer');
  if (
    typeof name !== 'string' ||
    name.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(name) ||
    typeof noopener !== 'boolean' ||
    typeof noreferrer !== 'boolean'
  )
    throw new Error('Invalid popup options');
  return internalRecord({
    carrier: 'popup',
    popup: internalRecord({ name, noopener: noopener || noreferrer, noreferrer }),
  });
}
