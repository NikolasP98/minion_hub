import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolvePublicDoor: vi.fn(), bumpDoorStat: vi.fn() }));
vi.mock('$server/services/doors.service', () => ({
  resolvePublicDoor: mocks.resolvePublicDoor,
  bumpDoorStat: mocks.bumpDoorStat,
}));

import { POST } from './+server';

let ipSeq = 0;
const call = (body: string, ip = `10.1.0.${++ipSeq}`) =>
  POST({
    params: { slug: 'qa-offer' },
    request: new Request('http://hub.test/x', { method: 'POST', body }),
    getClientAddress: () => ip,
  } as never) as Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolvePublicDoor.mockResolvedValue({
    ctx: { tenantId: 'org-1' },
    door: { id: 'd1', kind: 'offer' },
  });
});

describe('POST /api/doors/public/[slug]/click', () => {
  it('counts a whatsapp click sent as text/plain by sendBeacon', async () => {
    expect((await call('{"kind":"whatsapp"}')).status).toBe(204);
    expect(mocks.bumpDoorStat).toHaveBeenCalledWith({ tenantId: 'org-1' }, 'door:d1', 'clicks');
  });
  it('rejects unknown kinds and non-offer or unknown doors without counting', async () => {
    expect((await call('{"kind":"x"}')).status).toBe(400);
    expect((await call('nope')).status).toBe(400);
    mocks.resolvePublicDoor.mockResolvedValueOnce({ ctx: {}, door: { id: 'd2', kind: 'form' } });
    expect((await call('{"kind":"book"}')).status).toBe(404);
    mocks.resolvePublicDoor.mockResolvedValueOnce(null);
    expect((await call('{"kind":"book"}')).status).toBe(404);
    expect(mocks.bumpDoorStat).not.toHaveBeenCalled();
  });
  it('rate-limits one visitor', async () => {
    const ip = '10.9.9.9';
    for (let i = 0; i < 30; i++) await call('{"kind":"book"}', ip);
    expect((await call('{"kind":"book"}', ip)).status).toBe(429);
  });
});
