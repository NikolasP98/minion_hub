import { describe, it, expect, vi, afterEach } from 'vitest';
const service = vi.hoisted(() => ({ run: vi.fn(async () => ({ advanced: 0 })) }));
vi.mock('$server/services/pulse-tick', () => ({ runPulseTick: service.run }));
import { GET } from './+server';
afterEach(() => {
  delete process.env.CRON_SECRET;
  service.run.mockClear();
});
describe('exact authenticated digest tick route', () => {
  it('denies absent wrong or missing configured cron secrets before any collection', async () => {
    for (const secret of [undefined, 'configured-secret']) {
      if (secret) process.env.CRON_SECRET = secret;
      else delete process.env.CRON_SECRET;
      const url = new URL('http://127.0.0.1/api/pulse/tick');
      await expect(
        GET({ url, request: new Request(url) } as Parameters<typeof GET>[0]),
      ).rejects.toMatchObject({ status: 401 });
    }
    expect(service.run).not.toHaveBeenCalled();
  });
  it('rejects all caller scope selectors and only invokes the fixed trusted tick', async () => {
    process.env.CRON_SECRET = 'configured-secret';
    const url = new URL('http://127.0.0.1/api/pulse/tick?org=other');
    const request = new Request(url, { headers: { authorization: 'Bearer configured-secret' } });
    await expect(GET({ url, request } as Parameters<typeof GET>[0])).rejects.toMatchObject({
      status: 400,
    });
    expect(service.run).not.toHaveBeenCalled();
    url.search = '';
    expect(await (await GET({ url, request } as Parameters<typeof GET>[0])).json()).toEqual({
      advanced: 0,
    });
    expect(service.run).toHaveBeenCalledTimes(1);
  });
});
