import type { Installation } from './types';

type ApplicationAddress = Pick<Installation, 'id'> & {
  manifest: Pick<Installation['manifest'], 'id'>;
};

/** Public aliases select installations; full identities govern ownership. */
export function publicAlias(id: string): string {
  const digest = id.match(/-([a-f0-9]{64})$/)?.[1];
  if (!digest) throw new Error('Invalid installation identity');
  const pairs = digest.slice(0, 16).match(/../g);
  if (!pairs) throw new Error('Invalid installation alias');
  const bytes = Uint8Array.from(pairs, (hex) => Number.parseInt(hex, 16));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function applicationURL(app: ApplicationAddress, base: string | URL): URL {
  return new URL(`${publicAlias(app.id)}/${app.manifest.id}/`, base);
}

export function resourceURL(
  app: ApplicationAddress,
  path: string,
  base: string | URL,
): URL {
  return new URL(path, applicationURL(app, base));
}

export function applicationIdentity(
  input: string | URL,
  base: string | URL,
): string | null {
  try {
    const url = new URL(input);
    const root = new URL(base);
    if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname)) {
      return null;
    }
    const alias = url.pathname.slice(root.pathname.length).split('/')[0];
    return /^[A-Za-z0-9_-]{11}$/.test(alias) ? alias : null;
  } catch {
    return null;
  }
}
