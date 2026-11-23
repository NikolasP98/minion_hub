import { error, isHttpError } from '@sveltejs/kit';
import type postgres from 'postgres';
import { getPgClient } from '$server/db/pg-pool';
import { isSimulating } from '$server/auth/effective-authority';
import { brandingValidationAvailable, resolveBranding, validateHubName } from '$lib/branding';
import { requireOrgCapability } from './rbac.service';
import { readOrganizationAdminState, memberAuthority } from './organization-role-admin.service';

type IdentityRow = { id: string; name: string; hub_name: string | null; status: string };
function actor(locals: App.Locals) {
  const orgId = locals.tenantCtx?.tenantId;
  const profileId = locals.user?.supabaseId;
  if (!orgId || !profileId) throw error(401, 'Authenticated organization actor required');
  return { orgId, profileId };
}
async function admission(tx: postgres.TransactionSql, locals: App.Locals, write: boolean) {
  const { orgId, profileId } = actor(locals);
  await tx`select pg_advisory_xact_lock(hashtextextended(${profileId},114))`;
  await tx`select pg_advisory_xact_lock(hashtextextended(${orgId},112))`;
  const [profile] = await tx<
    { pending: boolean }[]
  >`select coalesce((to_jsonb(p)->>'deletion_pending')::boolean,false) as pending from public.profiles p where id=${profileId}::uuid for share`;
  if (!profile) throw error(401, 'Authenticated profile required');
  if (profile.pending) throw error(403, 'Active profile required');
  const [row] = await tx<
    IdentityRow[]
  >`select id,name,hub_name,status from public.organizations where id=${orgId}::uuid for update`;
  if (!row) throw error(404, 'Organization unavailable');
  if (row.status !== 'active') throw error(403, 'Active organization required');
  const state = await readOrganizationAdminState(tx, orgId);
  const member = state.members.find((m) => m.profile_id === profileId);
  const authority = memberAuthority(state, profileId);
  const simulation = isSimulating() || Boolean(locals.roleSimulation?.active);
  const canViewBrandingSettings = authority.platformAdmin || authority.caps.can('settings', 'view');
  const canEditBranding =
    !simulation &&
    brandingValidationAvailable() &&
    (authority.platformAdmin ||
      (member?.role === 'owner' && authority.caps.can('settings', 'manage')));
  if (write && simulation) throw error(403, 'Branding is read-only during role simulation');
  if (write && !canEditBranding)
    throw error(403, 'Organization owner and settings:manage required');
  return { row, canViewBrandingSettings, canEditBranding };
}
export async function loadOrganizationBrandingSettings(locals: App.Locals) {
  if (!locals.user?.supabaseId || !locals.tenantCtx?.tenantId) return null;
  try {
    return await getPgClient().begin('isolation level repeatable read', async (tx) => {
      const { row, canViewBrandingSettings, canEditBranding } = await admission(tx, locals, false);
      return {
        organizationName: row.name,
        hubName: row.hub_name,
        branding: resolveBranding(row),
        canViewBrandingSettings,
        canEditBranding,
      };
    });
  } catch (cause) {
    if (isHttpError(cause)) throw cause;
    console.error('[organization-branding] settings read unavailable');
    return {
      organizationName: '',
      hubName: null,
      branding: resolveBranding({ id: locals.tenantCtx.tenantId, name: '' }, 'unavailable'),
      canViewBrandingSettings: false,
      canEditBranding: false,
    };
  }
}
export async function saveOrganizationBranding(locals: App.Locals, hubName: string | null) {
  actor(locals);
  if (!brandingValidationAvailable()) throw error(503, 'Branding validation unavailable');
  const validation = hubName === null ? null : validateHubName(hubName);
  if (validation && !validation.ok) throw error(400, 'Invalid Hub name');
  const normalized = validation?.ok ? validation.value : null;
  return guardedWrite(locals, async (tx, row) => {
    const [updated] = await tx<
      IdentityRow[]
    >`update public.organizations set hub_name=${normalized} where id=${row.id}::uuid returning id,name,hub_name,status`;
    if (!updated) throw error(404, 'Organization unavailable');
    if (updated.id !== row.id || updated.hub_name !== normalized)
      throw error(500, 'Organization update unavailable');
    return { branding: resolveBranding(updated), hubName: updated.hub_name };
  });
}
export function validateTenantMetadata(input: unknown): { name?: string; slug?: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw error(400, 'Invalid organization fields');
  const fields = input as Record<string, unknown>;
  if (!Object.keys(fields).length || Object.keys(fields).some((k) => !['name', 'slug'].includes(k)))
    throw error(400, 'Invalid organization fields');
  const result: { name?: string; slug?: string } = {};
  if ('name' in fields) {
    if (typeof fields.name !== 'string') throw error(400, 'Invalid organization name');
    const name = fields.name.trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 80) throw error(400, 'Invalid organization name');
    result.name = name;
  }
  if ('slug' in fields) {
    if (
      typeof fields.slug !== 'string' ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(fields.slug)
    )
      throw error(400, 'Invalid organization slug');
    result.slug = fields.slug;
  }
  return result;
}
export async function saveOrganizationMetadata(locals: App.Locals, input: unknown) {
  actor(locals);
  if (!brandingValidationAvailable()) throw error(503, 'Branding validation unavailable');
  const fields = validateTenantMetadata(input);
  return guardedWrite(locals, async (tx, row) => {
    const [updated] = await tx<
      IdentityRow[]
    >`update public.organizations set ${tx(fields)} where id=${row.id}::uuid returning id,name,hub_name,status`;
    if (!updated) throw error(404, 'Organization unavailable');
    return updated;
  });
}
async function guardedWrite<T>(
  locals: App.Locals,
  update: (tx: postgres.TransactionSql, row: IdentityRow) => Promise<T>,
): Promise<T> {
  actor(locals);
  await requireOrgCapability(locals, 'settings', 'manage');
  try {
    const committed = await getPgClient().begin(async (tx) => {
      const { row } = await admission(tx, locals, true);
      return { result: await update(tx, row) };
    });
    return committed.result;
  } catch (cause) {
    if (isHttpError(cause)) throw cause;
    if ((cause as { code?: string })?.code === '23505')
      throw error(409, 'Organization slug already exists');
    console.error('[organization-branding] organization write unavailable');
    throw error(500, 'Organization update unavailable');
  }
}
/** Bounded reader for the two exact mutation schemas; never buffers an unbounded body. */
export async function readOrganizationMutationBody(request: Request): Promise<unknown> {
  if (
    (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() !==
    'application/json'
  )
    throw error(400, 'JSON body required');
  const reader = request.body?.getReader();
  if (!reader) throw error(400, 'JSON body required');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 2048) {
        await reader.cancel();
        throw error(400, 'Body too large');
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (cause) {
    if (isHttpError(cause)) throw cause;
    throw error(400, 'Invalid JSON body');
  }
}
