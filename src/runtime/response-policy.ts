interface ResponseOptions {
  scriptNonce?: string;
  workerSource?: string;
  controllerSource?: string;
}

function workerURL(value: string): URL {
  if (typeof value !== 'string' || /[\s;"'<>`]/.test(value))
    throw new Error('Invalid worker bootstrap source');
  const source = new URL(value);
  if (
    !['https:', 'http:'].includes(source.protocol) ||
    source.href !== value ||
    source.username ||
    source.password ||
    value.includes('?') ||
    value.includes('#')
  )
    throw new Error('Invalid worker bootstrap source');
  return source;
}

function workerSources(options: ResponseOptions): string {
  if (options.workerSource === undefined) {
    if (options.controllerSource !== undefined)
      throw new Error('Controller source requires a worker bootstrap directory');
    return "'none'";
  }
  const directory = workerURL(options.workerSource);
  if (!directory.pathname.endsWith('/'))
    throw new Error('Invalid worker bootstrap directory');
  if (options.controllerSource === undefined) return directory.href;
  const controller = workerURL(options.controllerSource);
  if (controller.origin !== directory.origin || controller.pathname.endsWith('/'))
    throw new Error('Invalid worker controller source');
  return directory.href + ' ' + controller.href;
}

/** Browser policy prevents effects that a service-worker fetch handler cannot cover. */
function policy(nonce: string | undefined, workerSource: string) {
  return [
    'sandbox allow-scripts allow-same-origin allow-forms',
    "frame-ancestors 'none'",
    "default-src 'none'",
    "manifest-src 'self'",
    "script-src 'self' blob: 'wasm-unsafe-eval'" + (nonce ? ` 'nonce-${nonce}'` : ''),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' blob: data:",
    "media-src 'self' blob: data:",
    "object-src 'none'",
    "frame-src 'none'",
    `worker-src ${workerSource}`,
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

const headers = {
  'X-Frame-Options': 'DENY',
  'X-DNS-Prefetch-Control': 'off',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cache-Control': 'no-store',
  'Permissions-Policy':
    'camera=(), microphone=(self), geolocation=(), usb=(), serial=(), hid=(), bluetooth=(), payment=(), attribution-reporting=(), browsing-topics=(), interest-cohort=()',
  'X-Content-Type-Options': 'nosniff',
};

export function response(
  body: BodyInit,
  type = 'text/html',
  status = 200,
  options: ResponseOptions = {},
): Response {
  if (options.scriptNonce && !/^[a-zA-Z0-9+/_-]+$/.test(options.scriptNonce))
    throw new Error('Invalid script nonce');
  return new Response(body, {
    status,
    headers: {
      ...headers,
      'Content-Security-Policy': policy(options.scriptNonce, workerSources(options)),
      'Content-Type': type,
    },
  });
}
