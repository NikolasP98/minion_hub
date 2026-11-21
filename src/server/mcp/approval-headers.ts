import type { Handle } from '@sveltejs/kit';
import { canonicalPath } from '$lib/canonical-path';

/**
 * Protective headers of the MCP approval screen (spec 143 D10, P5). They are set here, on the
 * final response, because the app renders with `ssr = false`: SvelteKit answers the document
 * without running the route's `load`, so `setHeaders` there never reaches the browser.
 */
export const APPROVAL_PATH = '/oauth/authorize';
export const APPROVAL_HEADERS = {
  'content-security-policy': "frame-ancestors 'none'",
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
} as const;

/** The document, its `__data.json` and the form-action responses all carry the headers. */
export const isApprovalPath = (pathname: string) =>
  canonicalPath(pathname.replace(/\/__data\.json$/, '')) === APPROVAL_PATH;

export const approvalHeadersHandle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  if (!isApprovalPath(event.url.pathname)) return response;
  // A response built by `fetch` or `redirect` can have immutable headers: copy when needed.
  let target = response;
  try {
    for (const [k, v] of Object.entries(APPROVAL_HEADERS)) response.headers.set(k, v);
  } catch {
    target = new Response(response.body, response);
    for (const [k, v] of Object.entries(APPROVAL_HEADERS)) target.headers.set(k, v);
  }
  return target;
};
