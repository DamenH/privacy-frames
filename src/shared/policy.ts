import { internalSet, strings, internalRecord } from './primordials.ts';
import type { InstallationMetadata } from './types';

export const LIMITS = Object.freeze(
  internalRecord({ files: 1000, bytes: 100 * 1024 * 1024 }),
);

const blockedElements = internalSet([
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'portal',
  'fencedframe',
  'webview',
  'base',
]);
/** Executable initial and dynamic script types supported by the host. */
export function isExecutableScriptType(type: string): boolean {
  return [
    '',
    'module',
    'text/javascript',
    'application/javascript',
    'text/ecmascript',
    'application/ecmascript',
  ].includes(strings.toLowerCase(strings.trim(type)));
}

/** These script types contain data and never execute as JavaScript. */
export function isDataScript(type: string): boolean {
  return ['application/json', 'application/ld+json'].includes(
    strings.toLowerCase(strings.trim(type)),
  );
}

export function elementAllowed(name: unknown): void {
  const tag = strings.toLowerCase(String(name));
  if (blockedElements.has(tag) || strings.includes(tag, ':')) {
    throw new Error(`Element not admitted: ${tag}`);
  }
}

export function safePath(path: unknown): string {
  if (
    typeof path !== 'string' ||
    !path ||
    path.length > 200 ||
    strings.startsWith(path, '/') ||
    strings.includes(path, '\\') ||
    strings.includes(path, '%') ||
    strings.includes(path, '?') ||
    strings.includes(path, '#') ||
    strings
      .split(path, '/')
      .some((segment) => !segment || segment === '.' || segment === '..')
  )
    throw new Error('Invalid installation path');
  return path;
}

export function validateMetadata(input: unknown): InstallationMetadata {
  if (!input || typeof input !== 'object')
    throw new Error('Invalid installation metadata');
  const value = input as Record<string, unknown>;
  if (
    typeof value.id !== 'string' ||
    !/^[-a-z0-9]{1,48}$/.test(value.id) ||
    typeof value.name !== 'string' ||
    !strings.trim(value.name) ||
    value.name.length > 100
  )
    throw new Error('Invalid installation metadata');
  const entry = safePath(value.entry);
  if (!strings.endsWith(entry, '.html')) throw new Error('Entry must be HTML');
  return internalRecord({ id: value.id, name: value.name, entry });
}

export async function digest(bytes: BufferSource): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, (byte) => strings.padStart(byte.toString(16), 2, '0')).join('');
}

const mediaTypes: Record<string, string> = internalRecord({
  html: 'text/html',
  js: 'text/javascript',
  mjs: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  webmanifest: 'application/manifest+json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  txt: 'text/plain',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  woff2: 'font/woff2',
  wasm: 'application/wasm',
});

export function mime(path: string): string {
  const extension = strings.split(path, '.').pop() ?? '';
  return Object.hasOwn(mediaTypes, extension)
    ? mediaTypes[extension]
    : 'application/octet-stream';
}
