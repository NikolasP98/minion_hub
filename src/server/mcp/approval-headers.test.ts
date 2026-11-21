import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APPROVAL_HEADERS, approvalHeadersHandle } from './approval-headers';

const run = (path: string, response: Response) =>
  approvalHeadersHandle({
    event: { url: new URL(`https://hub.test${path}`) },
    resolve: async () => response,
  } as never) as Promise<Response>;
const html = () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } });

describe('approval page headers (the document response, not load)', () => {
  it.each([
    '/oauth/authorize?client_id=x',
    '/en/oauth/authorize?client_id=x',
    '/es/oauth/authorize',
    '/oauth/authorize/__data.json',
    '/en/oauth/authorize/__data.json',
  ])('sets all four headers on %s', async (path) => {
    const res = await run(path, html());
    for (const [k, v] of Object.entries(APPROVAL_HEADERS)) expect(res.headers.get(k), k).toBe(v);
  });

  it('leaves every other path alone', async () => {
    for (const path of ['/login', '/oauth/authorized', '/en/oauth', '/api/oauth/token']) {
      const res = await run(path, html());
      expect(res.headers.get('x-frame-options'), path).toBeNull();
    }
  });

  it('works on a response whose headers are immutable', async () => {
    const res = await run('/oauth/authorize', Response.redirect('https://hub.test/login', 303));
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.status).toBe(303);
  });

  it('is wired into the hub handle sequence', () => {
    const hooks = readFileSync('src/hooks.server.ts', 'utf8');
    expect(hooks).toMatch(/export const handle = sequence\([\s\S]*approvalHeadersHandle,/);
  });
});
