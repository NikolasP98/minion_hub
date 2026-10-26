import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ submitFormDoor: vi.fn() }));
vi.mock('$server/services/doors-form.service', () => ({ submitFormDoor: mocks.submitFormDoor }));

import { POST } from './+server';

const DOOR = '11111111-2222-4333-8444-555555555555';
let ipSeq = 0;
const call = (body: unknown, opts: { ip?: string; slug?: string } = {}) =>
  POST({
    params: { slug: opts.slug ?? 'qa-intake' },
    request: new Request('http://hub.test/api/doors/public/qa-intake/submit', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    getClientAddress: () => opts.ip ?? `10.0.0.${++ipSeq}`,
  } as never) as Promise<Response>;

const values = { nombre: 'Ana Prueba', telefono: '+51 900 000 041' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.submitFormDoor.mockResolvedValue({ status: 'ok', message: 'Gracias' });
});

describe('POST /api/doors/public/[slug]/submit', () => {
  it('stores a valid submission and answers without echoing it', async () => {
    const attribution = {
      door: `door:${DOOR}`,
      utm_source: 'instagram',
      at: new Date().toISOString(),
    };
    const res = await call({ values, consent: true, attribution });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true, message: 'Gracias' });
    expect(text).not.toContain('Ana');
    expect(mocks.submitFormDoor).toHaveBeenCalledWith('qa-intake', {
      values,
      consent: true,
      attribution,
    });
  });

  it('honeypot filled → 200 ok and nothing is stored', async () => {
    const res = await call({ values, consent: true, website: 'http://spam.example' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message: null });
    expect(mocks.submitFormDoor).not.toHaveBeenCalled();
  });

  it('field errors → 400 with codes only', async () => {
    mocks.submitFormDoor.mockResolvedValue({
      status: 'invalid',
      errors: { telefono: 'invalid', consent: 'required' },
    });
    const res = await call({ values: { ...values, telefono: 'my-secret' }, consent: false });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      error: 'invalid',
      fields: { telefono: 'invalid', consent: 'required' },
    });
    expect(text).not.toContain('my-secret');
  });

  it('malformed bodies and foreign attribution keys → 400, service not called', async () => {
    expect((await call('not json')).status).toBe(400);
    expect((await call({ consent: true })).status).toBe(400);
    expect(
      (
        await call({
          values,
          attribution: { door: `door:${DOOR}`, at: new Date().toISOString(), ip: '1.2.3.4' },
        })
      ).status,
    ).toBe(400);
    expect(mocks.submitFormDoor).not.toHaveBeenCalled();
  });

  it('off or unknown door → 404', async () => {
    mocks.submitFormDoor.mockResolvedValue({ status: 'not_found' });
    const res = await call({ values, consent: true }, { slug: 'qa-door-off' });
    expect(res.status).toBe(404);
  });

  it('the 6th post in a minute from one IP to one slug gets 429; another slug is unaffected', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++)
      statuses.push((await call({ values, consent: true }, { ip: '203.0.113.9' })).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect(mocks.submitFormDoor).toHaveBeenCalledTimes(5);
    expect((await call({ values }, { ip: '203.0.113.9', slug: 'otra-puerta' })).status).toBe(200);
  });

  it('an unexpected failure → 500 with no detail, and the log carries no value', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.submitFormDoor.mockRejectedValue(
      Object.assign(new Error('Failed query: insert … params: Ana Prueba,+51 900 000 041'), {
        cause: { code: '23505' },
      }),
    );
    const res = await call({ values, consent: true });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'server_error' });
    expect(JSON.stringify(spy.mock.calls)).not.toContain('Ana');
    expect(JSON.stringify(spy.mock.calls)).toContain('23505');
    spy.mockRestore();
  });
});
