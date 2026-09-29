#!/usr/bin/env bun
/** Production-build negative proof for the development-only QA login surface. */
import assert from 'node:assert/strict';

const base = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5200';
const url = new URL(base);
assert(['localhost', '127.0.0.1'].includes(url.hostname), 'Loopback QA only');

async function response(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${base}${path}`, { redirect: 'manual', ...init });
}

const login = await response('/en/login');
assert.equal(login.status, 200, `GET /en/login returned ${login.status}`);
const html = await login.text();
assert(
  !html.includes('data-qa-login-picker'),
  'production build rendered the development QA login picker',
);
console.log('PASS production login HTML omits the development QA picker');

const sameOriginHeaders = {
  origin: base,
  'sec-fetch-site': 'same-origin',
};
const get = await response('/api/dev/qa-login', { headers: sameOriginHeaders });
assert.equal(get.status, 404, `GET /api/dev/qa-login returned ${get.status}`);

const post = await response('/api/dev/qa-login', {
  method: 'POST',
  headers: { ...sameOriginHeaders, 'content-type': 'application/json' },
  body: JSON.stringify({ userId: '00000000-0000-4000-8000-000000000001' }),
});
assert.equal(post.status, 404, `POST /api/dev/qa-login returned ${post.status}`);
console.log('PASS production build returns 404 for direct QA login GET and POST');
