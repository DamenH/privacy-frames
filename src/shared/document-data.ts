import { strings, internalRecord } from './primordials.ts';
import { LIMITS } from './policy.ts';

export function documentMediaKind(contentType: string): 'html' | 'svg' {
  const essence = strings.toLowerCase(strings.trim(strings.split(contentType, ';')[0]));
  if (essence === 'text/html') return 'html';
  if (essence === 'image/svg+xml') return 'svg';
  throw new Error('Only HTML and SVG document sources are supported');
}

function percentBytes(value: string): Uint8Array {
  const encoded = new TextEncoder().encode(value);
  const decoded = new Uint8Array(encoded.byteLength);
  let written = 0;
  const digit = (byte: number) =>
    byte >= 48 && byte <= 57
      ? byte - 48
      : byte >= 65 && byte <= 70
        ? byte - 55
        : byte >= 97 && byte <= 102
          ? byte - 87
          : -1;
  for (let index = 0; index < encoded.length; index++) {
    const high = digit(encoded[index + 1]),
      low = digit(encoded[index + 2]);
    if (encoded[index] === 37 && high >= 0 && low >= 0) {
      decoded[written++] = high * 16 + low;
      index += 2;
    } else decoded[written++] = encoded[index];
  }
  return decoded.subarray(0, written);
}

export function decodeDocumentDataURL(value: string): {
  kind: 'html' | 'svg';
  text: string;
} {
  const source = new URL(value);
  source.hash = '';
  const match = strings.match(source.href, /^data:([^,]*),([\s\S]*)$/i);
  if (!match) throw new Error('Invalid document data URL');
  const parameters = strings.split(match[1], ';');
  const kind = documentMediaKind(parameters[0]);
  const base64 =
    strings.toLowerCase(strings.trim(parameters[parameters.length - 1])) === 'base64';
  let bytes = percentBytes(match[2]);
  if (base64) {
    const binary = atob(
      new TextDecoder('utf-8', internalRecord({ fatal: true })).decode(bytes),
    );
    bytes = Uint8Array.from(binary, (character) => strings.charCodeAt(character, 0));
  }
  if (bytes.byteLength > LIMITS.bytes) throw new Error('Document data URL is too large');
  const charset = strings.match(match[1], /(?:^|;)\s*charset\s*=\s*([^;]+)/i)?.[1];
  return internalRecord({
    kind,
    text: new TextDecoder(charset || 'utf-8').decode(bytes),
  });
}
