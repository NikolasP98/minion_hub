import { describe, expect, it } from 'vitest';
import { csrfRefusal } from './csrf';

const call = (
  path: string,
  {
    method = 'POST',
    type = 'application/x-www-form-urlencoded',
    origin,
    accept,
  }: {
    method?: string;
    type?: string | null;
    origin?: string;
    accept?: string;
  } = {},
) => {
  const headers: Record<string, string> = {};
  if (type) headers['content-type'] = type;
  if (origin) headers.origin = origin;
  if (accept) headers.accept = accept;
  const url = new URL(`https://hub.test${path}`);
  return csrfRefusal(new Request(url, { method, headers }), url);
};

describe('csrfRefusal', () => {
  it('refuses a cross-site form POST to an ordinary route', async () => {
    const res = call('/login', { origin: 'https://evil.test' })!;
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('Cross-site POST form submissions are forbidden');
  });
  it('answers JSON when the caller asks for it', async () => {
    const res = call('/login', { origin: 'https://evil.test', accept: 'application/json' })!;
    expect(await res.json()).toEqual({ message: 'Cross-site POST form submissions are forbidden' });
  });
  it('lets a same-origin form POST through', () => {
    expect(call('/login', { origin: 'https://hub.test' })).toBeNull();
  });
  it('refuses a form POST with no Origin on any other path', () => {
    for (const p of ['/login', '/api/oauth/register', '/api/oauth/token/x', '/api/mcp'])
      expect(call(p)?.status).toBe(403);
  });
  it('lets a form POST with no Origin reach the token endpoint, and only it', () => {
    expect(call('/api/oauth/token')).toBeNull();
    expect(call('/api/oauth/token', { origin: 'https://evil.test' })).toBeNull();
  });
  it('lets JSON and safe methods through without Origin, like the built-in rule', () => {
    expect(call('/login', { type: 'application/json' })).toBeNull();
    expect(call('/login', { type: null })).toBeNull();
    expect(call('/login', { method: 'GET' })).toBeNull();
  });
  it('covers every form content type and unsafe method', () => {
    for (const type of [
      'multipart/form-data; boundary=x',
      'text/plain',
      'APPLICATION/X-WWW-FORM-URLENCODED',
    ])
      expect(call('/x', { type })?.status).toBe(403);
    for (const method of ['PUT', 'PATCH', 'DELETE'])
      expect(call('/x', { method })?.status).toBe(403);
  });
});
