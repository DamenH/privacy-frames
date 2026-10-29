import { LIMITS } from '../shared/policy.ts';

export const RESOURCE_LIST_BYTES = 256 * 1024;

/** Normalize a downloadable URL without granting any runtime authority. */
export function publicResourceURL(input: string, base?: string | URL): URL {
  const url = new URL(input, base);
  url.hash = '';
  if (
    url.username ||
    url.password ||
    !['https:', 'http:'].includes(url.protocol) ||
    (url.protocol === 'http:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    throw new Error('Installation requires public HTTPS resources');
  return url;
}

/** text/uri-list input contains absolute URLs; blank lines are accepted for paste. */
export function parseResourceList(text: string): string[] {
  if (new TextEncoder().encode(text).byteLength > RESOURCE_LIST_BYTES)
    throw new Error('Resource list exceeds 256 KiB');
  const urls = new Set<string>();
  for (const [index, line] of text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .entries()) {
    const value = line.trim();
    if (!value || value.startsWith('#')) continue;
    try {
      urls.add(publicResourceURL(value).href);
    } catch {
      throw new Error('Invalid absolute resource URL on line ' + (index + 1));
    }
    if (urls.size > LIMITS.files) throw new Error('Too many listed resources');
  }
  if (!urls.size) throw new Error('Resource list contains no URLs');
  return [...urls];
}
