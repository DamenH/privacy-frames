import type { HostConfig } from '../types';

export async function loadConfig(base: URL): Promise<HostConfig> {
  const response = await fetch(new URL('config.json', base));
  if (!response.ok) throw new Error('Host configuration unavailable.');
  const config: unknown = await response.json();
  if (!config || typeof config !== 'object')
    throw new Error('Invalid host configuration.');

  const value = config as Record<string, unknown>;
  if (typeof value.managerURL !== 'string' || typeof value.runtimeURL !== 'string') {
    throw new Error('Host origins are not configured.');
  }

  const manager = new URL(value.managerURL);
  const runtime = new URL(value.runtimeURL);
  if (manager.origin !== location.origin) {
    location.replace(manager.href);
    throw new Error('Opening the application library…');
  }
  if (runtime.origin === manager.origin) {
    throw new Error('Application storage requires a separate runtime origin.');
  }

  const examples = Array.isArray(value.examples)
    ? value.examples.filter(
        (item): item is { name: string; url: string } =>
          item !== null &&
          typeof item === 'object' &&
          typeof item.name === 'string' &&
          typeof item.url === 'string',
      )
    : [];

  return { managerURL: manager.href, runtimeURL: runtime.href, examples };
}

/** Management authority is issued only after a worker-controlled navigation. */
export async function initializeManager(base: URL): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('This browser does not support service workers.');
  }

  const initiallyControlled = Boolean(navigator.serviceWorker.controller);
  let registration: ServiceWorkerRegistration | undefined;
  try {
    registration = await navigator.serviceWorker.register(new URL('sw.js', base), {
      scope: base.pathname,
      updateViaCache: 'none',
    });
  } catch (error) {
    registration = await navigator.serviceWorker.getRegistration(base.pathname);
    if (!registration?.active) throw error;
  }

  await navigator.serviceWorker.ready;
  await registration.navigationPreload?.disable();
  if (!navigator.serviceWorker.controller) {
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
        once: true,
      });
    });
  }

  if (!initiallyControlled) {
    location.reload();
    await new Promise<never>(() => {});
  }
}
