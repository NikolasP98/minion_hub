import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolvePublicLink: vi.fn(), bumpDoorStat: vi.fn() }));
vi.mock('$server/services/scheduling-public.service', () => ({
  resolvePublicLink: mocks.resolvePublicLink,
}));
vi.mock('$server/services/doors.service', async (orig) => ({
  ...(await orig<typeof import('$server/services/doors.service')>()),
  bumpDoorStat: mocks.bumpDoorStat,
}));

import { load } from './+page.server';

const ID = '11111111-1111-1111-1111-111111111111';
function ev(ua: string | null, qs = '?utm_source=instagram') {
  const url = new URL('https://hub.test/book/s' + qs);
  const headers = new Headers();
  if (ua) headers.set('user-agent', ua);
  headers.set('referer', 'https://l.instagram.com/x?y=1');
  return {
    params: { slug: 's' },
    url,
    request: new Request(url, { headers }),
  } as unknown as Parameters<typeof load>[0];
}

describe('/book/[slug] load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolvePublicLink.mockResolvedValue({
      ctx: { tenantId: 'org' },
      link: { id: ID, slug: 's', title: 't', description: null },
      eventTypes: [],
    });
  });

  it('captures attribution and counts a human view', async () => {
    const out = (await load(ev('Mozilla/5.0 Safari'))) as { attribution: Record<string, string> };
    expect(out.attribution).toMatchObject({
      door: `book:${ID}`,
      utm_source: 'instagram',
      referrer_host: 'l.instagram.com',
    });
    expect(mocks.bumpDoorStat).toHaveBeenCalledWith({ tenantId: 'org' }, `book:${ID}`, 'views');
  });

  it('does not count a bot user agent', async () => {
    await load(ev('facebookexternalhit/1.1'));
    expect(mocks.bumpDoorStat).not.toHaveBeenCalled();
  });
});
