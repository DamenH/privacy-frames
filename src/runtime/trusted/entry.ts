import { compileDocumentContent } from '../contexts/document-content.ts';
import { parseDocumentContentInput } from '../contexts/document-protocol.ts';
import { prepareFragment } from './fragment.ts';
import { validateMarkup } from '../../shared/markup.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError('Invalid trusted computation request');
  return value;
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Expected text');
  return value;
}

/** Bundled once, evaluated only in our private context; no publisher code runs here. */
export function dispatch(operation: string, serialized: string): string {
  try {
    const input = record(JSON.parse(serialized));
    let value: unknown;
    if (operation === 'document') {
      const kind = input.kind;
      if (kind !== 'html' && kind !== 'svg') throw new TypeError('Invalid document kind');
      value = compileDocumentContent(
        parseDocumentContentInput(input, {
          kind,
          applicationURL: text(input.applicationURL),
        }),
      );
    } else if (operation === 'fragment') {
      value = prepareFragment({
        text: text(input.text),
        localName: text(input.localName),
        namespace: text(input.namespace),
        markerPrefix: text(input.markerPrefix),
      });
    } else if (operation === 'markup') {
      if (typeof input.document !== 'boolean')
        throw new TypeError('Invalid markup context');
      validateMarkup(text(input.text), { document: input.document });
      value = null;
    } else throw new TypeError('Unknown trusted computation operation');
    return JSON.stringify({ ok: true, value });
  } catch (error) {
    // Foreign Error objects and their constructor/prototype chains stay private.
    return JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : 'Trusted computation failed',
    });
  }
}
