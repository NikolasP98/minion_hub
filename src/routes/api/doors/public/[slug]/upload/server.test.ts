import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ uploadDoorFile: vi.fn() }));
vi.mock('$server/services/doors-form.service', () => ({ uploadDoorFile: mocks.uploadDoorFile }));
// No database here: the shared limiter falls back to the per-instance one.
vi.mock('$server/db/pg-client', () => ({
  getCoreDb: () => {
    throw new Error('no database in unit tests');
  },
}));

import { POST } from './+server';

let ipSeq = 0;
const call = (
  query: string,
  body: BodyInit | null = new Uint8Array([1, 2, 3]),
  opts: { ip?: string; headers?: Record<string, string> } = {},
) => {
  const url = new URL(`http://hub.test/api/doors/public/qa-intake/upload?${query}`);
  return POST({
    params: { slug: 'qa-intake' },
    url,
    request: new Request(url, {
      method: 'POST',
      body,
      headers: { 'content-type': 'image/jpeg', ...opts.headers },
    }),
    getClientAddress: () => opts.ip ?? `10.1.0.${++ipSeq}`,
  } as never) as Promise<Response>;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.uploadDoorFile.mockResolvedValue({ status: 'ok', fileId: 'f'.repeat(24) });
});

describe('POST /api/doors/public/[slug]/upload', () => {
  it('hands the raw body to the service and returns only the file id', async () => {
    const res = await call('field=foto&name=cara.jpg');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ fileId: 'f'.repeat(24) });
    expect(mocks.uploadDoorFile).toHaveBeenCalledWith('qa-intake', {
      field: 'foto',
      fileName: 'cara.jpg',
      contentType: 'image/jpeg',
      data: new Uint8Array([1, 2, 3]),
    });
  });

  it('rejects a bad field key, a missing name, an empty body and an oversized declared length', async () => {
    expect((await call('field=Bad Key&name=a.jpg')).status).toBe(400);
    expect((await call('field=foto')).status).toBe(400);
    expect((await call('field=foto&name=a.jpg', new Uint8Array())).status).toBe(400);
    const big = await call('field=foto&name=a.jpg', new Uint8Array([1]), {
      headers: { 'content-length': String(5 * 1024 * 1024) },
    });
    expect(big.status).toBe(413);
    expect(mocks.uploadDoorFile).not.toHaveBeenCalled();
  });

  it('maps service refusals to status codes', async () => {
    const cases = [
      ['not_found', 404],
      ['invalid_field', 400],
      ['mime_not_allowed', 400],
      ['too_large', 413],
      ['quota_exceeded', 507],
    ] as const;
    for (const [status, code] of cases) {
      mocks.uploadDoorFile.mockResolvedValueOnce({ status });
      const res = await call('field=foto&name=a.jpg');
      expect(res.status).toBe(code);
      expect(await res.json()).toEqual({ error: status });
    }
  });

  it('a storage failure answers 500 without the file name', async () => {
    mocks.uploadDoorFile.mockRejectedValueOnce(new Error('put failed for secreto.jpg'));
    const res = await call('field=foto&name=secreto.jpg');
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('secreto');
  });

  it('limits uploads per address and door', async () => {
    const ip = '10.9.9.9';
    for (let i = 0; i < 40; i++)
      expect((await call('field=foto&name=a.jpg', undefined, { ip })).status).toBe(200);
    expect((await call('field=foto&name=a.jpg', undefined, { ip })).status).toBe(429);
  });
});
