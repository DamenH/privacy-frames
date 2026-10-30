import { strings } from './primordials.ts';
import type { Installation } from './types';
const parseHex = Number.parseInt;

type ApplicationAddress = Pick<Installation, 'id'> & {
  manifest: Pick<Installation['manifest'], 'id'>;
};

/** Public aliases select installations; full identities govern ownership. */
export function publicAlias(id: string): string {
  const digest = strings.match(id, /-([a-f0-9]{64})$/)?.[1];
  if (!digest) throw new Error('Invalid installation identity');
  const pairs = strings.match(strings.slice(digest, 0, 16), /../g);
  if (!pairs) throw new Error('Invalid installation alias');
  const bytes = Uint8Array.from(pairs, (hex) => parseHex(hex, 16));
  return strings.replace(
    strings.replace(
      strings.replace(btoa(String.fromCharCode(...bytes)), /\+/g, '-'),
      /\//g,
      '_',
    ),
    /=+$/,
    '',
  );
}

export function applicationURL(app: ApplicationAddress, base: string | URL): URL {
  return new URL(`${publicAlias(app.id)}/${app.manifest.id}/`, base);
}

/** Launch configuration belongs to the document URL, never the resource base. */
export function applicationLaunchURL(
  app: ApplicationAddress & Pick<Installation, 'source'>,
  base: string | URL,
): URL {
  const launch = applicationURL(app, base);
  launch.search = new URL(app.source).search;
  return launch;
}

export function resourceURL(
  app: ApplicationAddress,
  path: string,
  base: string | URL,
): URL {
  // A first path segment containing ':' is a filename, not a URL scheme.
  return new URL(`./${path}`, applicationURL(app, base));
}

export function applicationIdentity(
  input: string | URL,
  base: string | URL,
): string | null {
  try {
    const url = new URL(input);
    const root = new URL(base);
    if (url.origin !== root.origin || !strings.startsWith(url.pathname, root.pathname)) {
      return null;
    }
    const alias = strings.split(
      strings.slice(url.pathname, root.pathname.length),
      '/',
    )[0];
    return /^[A-Za-z0-9_-]{11}$/.test(alias) ? alias : null;
  } catch {
    return null;
  }
}
