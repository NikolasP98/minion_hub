import { beforeEach, expect, it, vi } from 'vitest';
import { GET } from './+server';

const boundary = vi.hoisted(() => ({ list: vi.fn(), taken: vi.fn() }));
vi.mock('$server/services/mention-directory', () => ({ listMentionDirectory: boundary.list }));
vi.mock('$server/services/user.service', () => ({ isAliasTaken: boundary.taken }));

const ACTOR = '10000000-0000-4000-8000-000000000001';
const ORG = '20000000-0000-4000-8000-000000000001';
const result = { actorId: ACTOR, organizationId: ORG, aliases: {} };
type Options = { query?: string; tenant?: boolean; user?: 'current' | 'none' | 'legacy' };
function event({ query = '', tenant = true, user = 'current' }: Options = {}) {
  return {
    url: new URL(`https://synthetic.invalid/api/users/aliases${query}`),
    locals: {
      tenantCtx: tenant ? { tenantId: ORG, db: {} } : undefined,
      user:
        user === 'none'
          ? undefined
          : { id: 'legacy-row-id', ...(user === 'current' ? { supabaseId: ACTOR } : {}) },
    },
  } as Parameters<typeof GET>[0];
}

beforeEach(() => {
  vi.resetAllMocks();
  boundary.list.mockResolvedValue(result);
  boundary.taken.mockResolvedValue(false);
});

it('uses the canonical authenticated actor and tenant and marks directory responses private and uncacheable', async () => {
  const response = await GET(event({ query: '?actorId=untrusted&organizationId=untrusted' }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(result);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(boundary.list).toHaveBeenCalledExactlyOnceWith({ actorId: ACTOR, organizationId: ORG });
  expect(boundary.taken).not.toHaveBeenCalled();
});

it.each([{ tenant: false }, { user: 'none' }, { user: 'legacy' }] as Options[])(
  'rejects directory reads without current browser and tenant identity: %j',
  async (options) => {
    await expect(GET(event(options))).rejects.toMatchObject({ status: 401 });
    expect(boundary.list).not.toHaveBeenCalled();
  },
);

it('preserves organization admission failures instead of returning a successful empty directory', async () => {
  const { error } = await import('@sveltejs/kit');
  boundary.list.mockImplementation(() => {
    error(403, 'Mention directory access is not permitted.');
  });
  await expect(GET(event())).rejects.toMatchObject({ status: 403 });
});

it.each([false, true])(
  'preserves global alias availability without loading the directory: taken=%j',
  async (taken) => {
    boundary.taken.mockResolvedValue(taken);
    const response = await GET(event({ query: '?check=COLLEAGUE', user: 'none' }));
    expect(await response.json()).toEqual(
      taken ? { available: false, reason: 'taken' } : { available: true },
    );
    expect(boundary.taken).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ tenantId: ORG }),
      'colleague',
    );
    expect(boundary.list).not.toHaveBeenCalled();
  },
);

it('rejects malformed alias availability input before database access', async () => {
  const response = await GET(event({ query: '?check=%3Cscript%3E' }));
  expect(await response.json()).toEqual({ available: false, reason: 'invalid' });
  expect(boundary.taken).not.toHaveBeenCalled();
  expect(boundary.list).not.toHaveBeenCalled();
});
