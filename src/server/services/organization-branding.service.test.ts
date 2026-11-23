import { beforeEach, describe, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  owner: true,
  manage: true,
  platform: false,
  simulation: false,
  profile: true,
  pending: false,
  active: true,
  row: true,
  zero: false,
  fail: '',
  calls: [] as string[],
  gate: vi.fn(),
}));
vi.mock('$server/auth/effective-authority', () => ({ isSimulating: () => f.simulation }));
vi.mock('./rbac.service', () => ({
  requireOrgCapability: (...args: unknown[]) => f.gate(...args),
}));
vi.mock('./organization-role-admin.service', () => ({
  readOrganizationAdminState: vi.fn(async () => ({
    members: [{ profile_id: 'p', role: f.owner ? 'owner' : 'member' }],
  })),
  memberAuthority: () => ({
    platformAdmin: f.platform,
    caps: { can: (_m: string, action: string) => action === 'view' || f.manage },
  }),
}));
vi.mock('$server/db/pg-pool', () => {
  const tx = async (strings: TemplateStringsArray | object, ...values: unknown[]) => {
    if (!Array.isArray(strings)) return {};
    const sql = (strings as unknown as string[]).join('?');
    f.calls.push(sql);
    if (sql.includes('from public.profiles')) return f.profile ? [{ pending: f.pending }] : [];
    if (sql.includes('update public.organizations')) {
      if (f.fail) throw { code: f.fail };
      return f.zero
        ? []
        : [
            {
              id: 'o',
              name: 'Faces',
              hub_name: typeof values[0] === 'object' ? null : values[0],
              status: 'active',
            },
          ];
    }
    if (sql.includes('from public.organizations'))
      return f.row
        ? [{ id: 'o', name: 'Faces', hub_name: null, status: f.active ? 'active' : 'disabled' }]
        : [];
    return [];
  };
  return {
    getPgClient: () => ({
      begin: (...args: unknown[]) => (args.at(-1) as (tx: unknown) => unknown)(tx),
    }),
  };
});
import {
  loadOrganizationBrandingSettings,
  saveOrganizationBranding,
  saveOrganizationMetadata,
  validateTenantMetadata,
  readOrganizationMutationBody,
} from './organization-branding.service';
const locals = { user: { id: 'u', supabaseId: 'p' }, tenantCtx: { tenantId: 'o' } } as App.Locals;
beforeEach(() => {
  Object.assign(f, {
    owner: true,
    manage: true,
    platform: false,
    simulation: false,
    profile: true,
    pending: false,
    active: true,
    row: true,
    zero: false,
    fail: '',
    calls: [],
  });
  f.gate.mockReset();
});
describe('locked organization identity boundary', () => {
  it('requires verified profile and context; fabricated auth bypass cannot write', async () => {
    await expect(
      saveOrganizationBranding(
        { ...locals, user: { id: 'dev', role: 'admin' } } as App.Locals,
        'A',
      ),
    ).rejects.toMatchObject({ status: 401 });
    f.profile = false;
    await expect(saveOrganizationBranding(locals, 'A')).rejects.toMatchObject({ status: 401 });
    expect(f.calls.some((s) => s.startsWith('update'))).toBe(false);
  });
  it('locks actor then organization and reads canonical authority before writing', async () => {
    const result = await saveOrganizationBranding(locals, ' Draft ');
    expect(f.gate).toHaveBeenCalledWith(locals, 'settings', 'manage');
    expect(f.calls[0]).toContain('114');
    expect(f.calls[1]).toContain('112');
    expect(result).toMatchObject({
      hubName: 'Draft',
      branding: { orgId: 'o', name: 'Draft', source: 'custom', readStatus: 'ready' },
    });
  });
  it.each(['owner', 'manage', 'active'] as const)(
    'rejects loss of %s before update',
    async (flag) => {
      f[flag] = false;
      await expect(saveOrganizationBranding(locals, 'A')).rejects.toMatchObject({ status: 403 });
      await expect(saveOrganizationMetadata(locals, { name: 'New' })).rejects.toMatchObject({
        status: 403,
      });
      expect(f.calls.some((s) => s.startsWith('update'))).toBe(false);
    },
  );
  it('inactive role-simulation metadata permits an ordinary owner write', async () => {
    await expect(
      saveOrganizationBranding({ ...locals, roleSimulation: { active: false } } as App.Locals, 'A'),
    ).resolves.toBeDefined();
  });
  it('uses fresh platform admin only with current membership/profile and disallows simulation', async () => {
    f.platform = true;
    f.owner = false;
    f.manage = false;
    await expect(saveOrganizationBranding(locals, null)).resolves.toBeDefined();
    f.simulation = true;
    await expect(saveOrganizationBranding(locals, 'A')).rejects.toMatchObject({ status: 403 });
    expect(await loadOrganizationBrandingSettings(locals)).toMatchObject({
      canEditBranding: false,
    });
    f.simulation = false;
    f.pending = true;
    await expect(saveOrganizationBranding(locals, 'A')).rejects.toMatchObject({ status: 403 });
  });
  it('does not fabricate success for missing and zero-return rows; maps unique slug failures', async () => {
    f.row = false;
    await expect(saveOrganizationBranding(locals, 'A')).rejects.toMatchObject({ status: 404 });
    f.row = true;
    f.zero = true;
    await expect(saveOrganizationBranding(locals, 'A')).rejects.toMatchObject({ status: 404 });
    f.zero = false;
    f.fail = '23505';
    await expect(saveOrganizationMetadata(locals, { slug: 'duplicate' })).rejects.toMatchObject({
      status: 409,
    });
    f.fail = 'XX000';
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(saveOrganizationBranding(locals, 'A')).rejects.toMatchObject({ status: 500 });
    log.mockRestore();
  });
  it('both identity mutations return unavailable rather than denied without Unicode runtime support', async () => {
    vi.stubGlobal('Intl', { ...Intl, Segmenter: undefined });
    try {
      await expect(saveOrganizationBranding(locals, 'A')).rejects.toMatchObject({ status: 503 });
      await expect(saveOrganizationMetadata(locals, { name: 'Faces' })).rejects.toMatchObject({
        status: 503,
      });
      expect(f.calls).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('validates before SQL and keeps name/slug separate from prefix fields', async () => {
    for (const input of [
      {},
      [],
      null,
      { name: null },
      { slug: null },
      { name: '' },
      { name: 'x' },
      { name: 'x'.repeat(81) },
      { slug: 'x'.repeat(64) },
      { slug: 'UPPER' },
      { slug: ' x' },
      { slug: 'a_' },
      { hubName: 'x' },
      { hub_name: 'x' },
      { metadata: '' },
    ])
      expect(() => validateTenantMetadata(input)).toThrow();
    expect(validateTenantMetadata({ name: ' a  b ', slug: 'a' })).toEqual({
      name: 'a b',
      slug: 'a',
    });
    expect(validateTenantMetadata({ name: 'x'.repeat(80), slug: 'x'.repeat(63) })).toBeDefined();
    await expect(saveOrganizationBranding(locals, 'Faces Hub')).rejects.toMatchObject({
      status: 400,
    });
    expect(f.calls).toHaveLength(0);
  });
  it('bounds streaming JSON by UTF-8 bytes and rejects malformed or non-JSON bodies', async () => {
    for (const [body, type] of [
      ['{', 'application/json'],
      ['{}', 'text/plain'],
      ['{}', 'application/jsonp'],
      ['{}', 'application/json+garbage'],
      ['界'.repeat(700), 'application/json'],
    ])
      await expect(
        readOrganizationMutationBody(
          new Request('http://localhost', {
            method: 'PATCH',
            headers: { 'content-type': type },
            body,
          }),
        ),
      ).rejects.toMatchObject({ status: 400 });
    expect(
      await readOrganizationMutationBody(
        new Request('http://localhost', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: '{"hubName":null}',
        }),
      ),
    ).toEqual({ hubName: null });
  });
});
