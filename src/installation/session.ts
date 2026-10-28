/** Only the trusted manager may start a preparation session. */
export interface InstallationSession {
  type: 'pf-install-connect';
  session: string;
}

export type InstallationReply =
  | { type: 'ready'; session: string }
  | { type: 'progress'; session: string; message: string }
  | { type: 'prepared'; session: string; installation: unknown }
  | { type: 'failed'; session: string; error: string };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function installationSession(value: unknown): InstallationSession | undefined {
  if (
    !isRecord(value) ||
    value.type !== 'pf-install-connect' ||
    typeof value.session !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(value.session)
  )
    return;
  return { type: 'pf-install-connect', session: value.session };
}

export function installationReply(value: unknown, session: string): InstallationReply {
  if (!isRecord(value) || value.session !== session)
    throw new Error('Invalid installation session response');
  switch (value.type) {
    case 'ready':
      return { type: 'ready', session };
    case 'progress':
      if (typeof value.message === 'string' && value.message.length <= 2000)
        return { type: 'progress', session, message: value.message };
      break;
    case 'prepared':
      if (isRecord(value.installation))
        return { type: 'prepared', session, installation: value.installation };
      break;
    case 'failed':
      if (typeof value.error === 'string' && value.error.length <= 2000)
        return { type: 'failed', session, error: value.error };
      break;
  }
  throw new Error('Invalid installation session response');
}

export function installationRequest(value: unknown, session: string): string {
  if (
    !isRecord(value) ||
    value.type !== 'prepare' ||
    value.session !== session ||
    typeof value.url !== 'string' ||
    value.url.length > 16384
  )
    throw new Error('Invalid installation request');
  return value.url;
}

export function installationConfiguration(value: unknown, origin: string): string {
  if (
    !isRecord(value) ||
    typeof value.managerURL !== 'string' ||
    typeof value.runtimeURL !== 'string' ||
    typeof value.installationURL !== 'string'
  )
    throw new Error('Installation origins are not configured');
  const manager = new URL(value.managerURL);
  const runtime = new URL(value.runtimeURL);
  const installation = new URL(value.installationURL);
  for (const url of [manager, runtime, installation])
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.endsWith('/') ||
      (url.protocol !== 'https:' &&
        !(
          url.protocol === 'http:' &&
          ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
        ))
    )
      throw new Error('Invalid installation origin configuration');
  if (
    installation.origin !== origin ||
    new Set([manager.origin, runtime.origin, installation.origin]).size !== 3
  )
    throw new Error('Installation requires a separate origin');
  return manager.origin;
}
