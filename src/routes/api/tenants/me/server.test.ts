import { beforeEach, describe, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));
vi.mock('$server/services/tenant.service', () => ({ getTenant: f.get, updateTenant: f.update }));
vi.mock('$server/services/organization-branding.service', () => ({
  readOrganizationMutationBody: (request: Request) => request.json(),
}));
import { GET, PATCH } from './+server';
function event(body: unknown) {
  return {
    locals: { user: { supabaseId: 'p' }, tenantCtx: { tenantId: 'o' } },
    request: new Request('http://localhost/api/tenants/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as never;
}
beforeEach(() => {
  vi.clearAllMocks();
  f.get.mockResolvedValue({ id: 'o', name: 'Faces' });
});
describe('tenant identity handler', () => {
  it('retains member GET and delegates PATCH with verified locals, never bare TenantContext', async () => {
    const e = event({ name: 'Faces' });
    expect(await (await GET(e)).json()).toMatchObject({ tenant: { id: 'o' } });
    expect(await (await PATCH(e)).json()).toEqual({ ok: true });
    expect(f.update).toHaveBeenCalledWith((e as { locals: unknown }).locals, { name: 'Faces' });
  });
  it('propagates schema, authority and conflict errors without success', async () => {
    for (const status of [400, 401, 403, 404, 409, 500]) {
      f.update.mockRejectedValueOnce({ status });
      await expect(PATCH(event({ name: 'No' }))).rejects.toMatchObject({ status });
    }
  });
});
