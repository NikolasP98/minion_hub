import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  env: {} as Record<string, string>,
  filters: [] as Array<[string, unknown]>,
  limit: vi.fn(),
  select: vi.fn(),
}));
vi.mock('$env/dynamic/public', () => ({ env: mock.env }));
vi.mock('$server/supabase', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const query = {
        select: (columns: string) => {
          mock.select(columns);
          return query;
        },
        eq: (key: string, value: unknown) => {
          mock.filters.push([key, value]);
          return query;
        },
        limit: mock.limit,
      };
      return query;
    },
  }),
}));
import { resolveJoinRequestTarget } from './request-target';
beforeEach(() => {
  delete mock.env.PUBLIC_DEFAULT_ORG_SLUG;
  mock.filters.length = 0;
  vi.clearAllMocks();
  mock.limit.mockResolvedValue({
    data: [{ id: 'exact-org', name: 'Current workspace' }],
    error: null,
  });
});
describe('public join target', () => {
  it('selects only the configured active slug without listing organization details', async () => {
    mock.env.PUBLIC_DEFAULT_ORG_SLUG = 'faces';
    expect(await resolveJoinRequestTarget()).toEqual({
      id: 'exact-org',
      name: 'Current workspace',
    });
    expect(mock.filters).toEqual([
      ['status', 'active'],
      ['slug', 'faces'],
    ]);
    expect(mock.select).toHaveBeenCalledWith('id,name');
    expect(mock.limit).toHaveBeenCalledWith(2);
  });
  it('permits a single active organization without a configured slug', async () => {
    expect(await resolveJoinRequestTarget()).toEqual({
      id: 'exact-org',
      name: 'Current workspace',
    });
    expect(mock.filters).toEqual([['status', 'active']]);
  });
  it.each([{ data: [] }, { data: [{ id: 'a' }, { id: 'b' }] }])(
    'rejects missing or ambiguous targets without alphabetical fallback $data',
    async ({ data }) => {
      mock.limit.mockResolvedValueOnce({ data, error: null });
      await expect(resolveJoinRequestTarget()).rejects.toMatchObject({ status: 503 });
    },
  );
  it('does not fall back when a configured slug is missing', async () => {
    mock.env.PUBLIC_DEFAULT_ORG_SLUG = 'missing';
    mock.limit.mockResolvedValueOnce({ data: [], error: null });
    await expect(resolveJoinRequestTarget()).rejects.toMatchObject({ status: 503 });
    expect(mock.limit).toHaveBeenCalledTimes(1);
  });
  it('does not reveal provider errors', async () => {
    mock.limit.mockResolvedValueOnce({ data: null, error: { message: 'PRIVATE_PROVIDER' } });
    await expect(resolveJoinRequestTarget()).rejects.toMatchObject({
      status: 503,
      body: {
        message: 'Access requests are unavailable for this workspace. Please use an invite link.',
      },
    });
  });
});
