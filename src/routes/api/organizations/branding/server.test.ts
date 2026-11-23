import { beforeEach, describe, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('$server/services/organization-branding.service', () => ({
  readOrganizationMutationBody: (request: Request) => request.json(),
  saveOrganizationBranding: f.save,
}));
import { PATCH } from './+server';
function event(body: unknown, user = true) {
  return {
    locals: { user: user ? { supabaseId: 'p' } : null, tenantCtx: { tenantId: 'o' } },
    request: new Request('http://localhost/api/organizations/branding', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as never;
}
beforeEach(() => {
  f.save.mockReset();
  f.save.mockResolvedValue({
    branding: {
      orgId: 'o',
      name: 'Faces',
      fullName: 'Faces Hub',
      source: 'custom',
      readStatus: 'ready',
    },
    hubName: 'Faces',
  });
});
describe('PATCH organization branding', () => {
  it('requires verified authentication before mutation', async () => {
    await expect(PATCH(event({ hubName: 'Faces' }, false))).rejects.toMatchObject({ status: 401 });
    expect(f.save).not.toHaveBeenCalled();
  });
  it.each([{}, [], null, { hubName: 1 }, { hubName: 'x', orgId: 'foreign' }, { hub_name: 'x' }])(
    'rejects exact schema violations %j',
    async (body) => {
      await expect(PATCH(event(body))).rejects.toMatchObject({ status: 400 });
      expect(f.save).not.toHaveBeenCalled();
    },
  );
  it('returns committed projection with private no-store and passes verified locals', async () => {
    const e = event({ hubName: 'Faces' });
    const response = await PATCH(e);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(f.save).toHaveBeenCalledWith((e as { locals: unknown }).locals, 'Faces');
    expect(await response.json()).toMatchObject({ hubName: 'Faces' });
  });
  it('preserves null automatic reset and propagates authority/write failures', async () => {
    await PATCH(event({ hubName: null }));
    expect(f.save).toHaveBeenLastCalledWith(expect.anything(), null);
    for (const status of [401, 403, 404, 409, 500, 503]) {
      f.save.mockRejectedValueOnce({ status });
      await expect(PATCH(event({ hubName: 'Faces' }))).rejects.toMatchObject({ status });
    }
  });
});
