/** Browser policy prevents effects that a service-worker fetch handler cannot cover. */
const policy = [
  'sandbox allow-scripts allow-same-origin allow-forms',
  "frame-ancestors 'none'",
  "default-src 'none'",
  "manifest-src 'self'",
  "script-src 'self' blob: 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data:",
  "media-src 'self' blob: data:",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

const headers = {
  'Content-Security-Policy': policy,
  'X-Frame-Options': 'DENY',
  'X-DNS-Prefetch-Control': 'off',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cache-Control': 'no-store',
  'Permissions-Policy':
    'camera=(), microphone=(self), geolocation=(), usb=(), serial=(), hid=(), bluetooth=(), payment=(), attribution-reporting=(), browsing-topics=(), interest-cohort=()',
  'X-Content-Type-Options': 'nosniff',
};

export function response(body: BodyInit, type = 'text/html', status = 200): Response {
  return new Response(body, { status, headers: { ...headers, 'Content-Type': type } });
}
