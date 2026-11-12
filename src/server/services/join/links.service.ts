import { supabaseAdmin } from '$server/supabase';
import type { MembershipUser } from './membership';

export interface JoinLinkRow {
  id: string;
  token: string;
  organization_id: string;
  role: string;
  role_revision?: string | null;
  grantor_profile_id?: string | null;
  revoked: boolean;
  expires_at: string | null;
  max_uses: number | null;
  uses_count: number;
}

export async function createLink(opts: {
  organizationId: string;
  role?: string;
  createdBy: string;
  grantorProfileId?: string;
  expiresAt?: string | null;
  maxUses?: number | null;
}): Promise<{ id: string; token: string }> {
  if (!opts.grantorProfileId) throw new Error('Authenticated grantor profile required');
  const { mintOrganizationInvite } = await import('./organization-admission');
  return mintOrganizationInvite({ ...opts, grantorProfileId: opts.grantorProfileId });
}

export async function resolveLink(token: string): Promise<JoinLinkRow | null> {
  const { data } = await supabaseAdmin().from('join_link').select('*').eq('token', token).single();
  return (data as JoinLinkRow) ?? null;
}

export async function consumeLink(
  token: string,
  u: MembershipUser,
): Promise<{ organizationId: string }> {
  const { consumeOrganizationInvite } = await import('./organization-admission');
  return consumeOrganizationInvite(token, u);
}

/** Active join links, optionally scoped to one org (callers should always pass
 *  the caller's tenant — see D4: an unscoped list used to leak every org's
 *  links to any org admin). */
export async function listLinks(organizationId?: string): Promise<JoinLinkRow[]> {
  let q = supabaseAdmin().from('join_link').select('*').eq('revoked', false);
  if (organizationId) q = q.eq('organization_id', organizationId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as JoinLinkRow[];
}

/** Revoke a link. When `organizationId` is given, the update is scoped to it —
 *  returns false (no row matched) instead of revoking another org's link. */
export async function revokeLink(id: string, organizationId?: string): Promise<boolean> {
  let q = supabaseAdmin().from('join_link').update({ revoked: true }).eq('id', id);
  if (organizationId) q = q.eq('organization_id', organizationId);
  const { data, error } = await q.select();
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}
