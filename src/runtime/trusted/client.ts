import source from 'trusted:policy-source';
import { internalData, internalRecord } from '../../shared/primordials.ts';
import type {
  CompiledDocumentContent,
  DocumentContentInput,
} from '../contexts/document-content-types.ts';
import { createTrustedContext, type TrustedBackend } from './context.ts';
import type { FragmentInput, PreparedFragment } from './fragment.ts';

type Reply<T> = { ok: true; value: T } | { ok: false; error: string };

export interface TrustedPolicy {
  compile(input: DocumentContentInput): CompiledDocumentContent;
  fragment(input: FragmentInput): PreparedFragment;
  validateMarkup(text: string, document?: boolean): void;
}

/** Kept in bootstrap closures, never installed on an application-facing object. */
export function createTrustedPolicy(
  applicationURL: string,
  backend?: TrustedBackend,
): TrustedPolicy {
  const stringify = JSON.stringify;
  const parse = JSON.parse;
  const call = createTrustedContext(source, backend);
  function invoke<T>(operation: string, input: object): T {
    // This is the private bundled producer's typed response, not an external
    // message. The producer validates input; JSON creates local owned records.
    const packet: Reply<T> = internalData(parse(call(operation, stringify(input))));
    if (!packet || typeof packet !== 'object')
      throw new Error('Trusted computation returned invalid data');
    if (packet.ok === false && typeof packet.error === 'string')
      throw new Error(packet.error);
    if (packet.ok !== true) throw new Error('Trusted computation returned invalid data');
    return packet.value;
  }
  return internalRecord({
    compile(input) {
      return invoke('document', internalRecord({ ...input, applicationURL }));
    },
    fragment(input) {
      return invoke('fragment', input);
    },
    validateMarkup(text, document = false) {
      invoke('markup', internalRecord({ text, document }));
    },
  });
}
