/**
 * The form-origin rule SvelteKit applies in production (`runtime/server/respond.js`), kept as a
 * pure function so it also runs in dev and in tests (spec 143 P1). `kit.csrf.trustedOrigins: ['*']`
 * switches the built-in check off; `csrfHandle` applies this one instead, except on the token
 * endpoint, whose callers are command-line harnesses that send no `Origin`.
 */
export const CSRF_EXEMPT_PATH = '/api/oauth/token';

const FORM_TYPES = new Set([
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
  'application/x-sveltekit-formdata',
]);
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * True when the browser itself says the request comes from this origin: a matching `Origin`, or
 * `Sec-Fetch-Site: same-origin`. A page cannot set either header, and the second one survives a
 * privacy setting or extension that blanks or rewrites `Origin` (spec 143 rollout).
 */
export const fromSameOrigin = (request: Request, url: URL) =>
  request.headers.get('origin') === url.origin ||
  request.headers.get('sec-fetch-site') === 'same-origin';

export function csrfRefusal(request: Request, url: URL): Response | null {
  const type = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (
    !FORM_TYPES.has(type) ||
    !UNSAFE_METHODS.has(request.method) ||
    fromSameOrigin(request, url) ||
    url.pathname === CSRF_EXEMPT_PATH
  )
    return null;
  // Header values only, never the body: enough to tell which browser behaviour was refused.
  console.warn('[csrf] refused', url.pathname, {
    origin: request.headers.get('origin'),
    site: request.headers.get('sec-fetch-site'),
  });
  const message = `Cross-site ${request.method} form submissions are forbidden`;
  return request.headers.get('accept') === 'application/json'
    ? new Response(JSON.stringify({ message }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      })
    : new Response(message, { status: 403, headers: { 'content-type': 'text/plain' } });
}
