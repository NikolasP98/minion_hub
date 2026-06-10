import { supabaseAdmin } from '$server/supabase';
import { createMembership, type MembershipUser } from './membership';
import { generateOpaqueToken, isLinkUsable } from './helpers';

export interface JoinLinkRow {
  id: string;
  token: string;
  organization_id: string;
  role: string;
  revoked: boolean;
  expires_at: string | null;
  max_uses: number | null;
  uses_count: number;
}

export async function createLink(opts: {
  organizationId: string;
  role: string;
  createdBy: string;
  expiresAt?: string | null;
  maxUses?: number | null;
}): Promise<{ id: string; token: string }> {
  const token = generateOpaqueToken();
  const { data, error } = await supabaseAdmin()
    .from('join_link')
    .insert({
      token,
      organization_id: opts.organizationId,
      role: opts.role,
      created_by: opts.createdBy,
      expires_at: opts.expiresAt ?? null,
      max_uses: opts.maxUses ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return { id: (data as any).id, token };
}

export async function resolveLink(token: string): Promise<JoinLinkRow | null> {
  const { data } = await supabaseAdmin().from('join_link').select('*').eq('token', token).single();
  return (data as JoinLinkRow) ?? null;
}

export async function consumeLink(token: string, u: MembershipUser): Promise<{ organizationId: string }> {
  const link = await resolveLink(token);
  if (!link) throw new Error('link not found');
  const usable = isLinkUsable(
    {
      revoked: link.revoked,
      expiresAt: link.expires_at ? new Date(link.expires_at) : null,
      maxUses: link.max_uses,
      usesCount: link.uses_count,
    },
    new Date(),
  );
  if (!usable) throw new Error('link not usable');

  const sb = supabaseAdmin();
  if (link.max_uses != null) {
    const { data: bumped } = await sb
      .from('join_link')
      .update({ uses_count: link.uses_count + 1 })
      .eq('token', token)
      .lt('uses_count', link.max_uses)
      .select();
    if (!bumped || bumped.length === 0) throw new Error('link no longer available');
  } else {
    await sb.from('join_link').update({ uses_count: link.uses_count + 1 }).eq('token', token);
  }

  await createMembership(u, link.organization_id, link.role);
  return { organizationId: link.organization_id };
}

export async function listLinks(): Promise<JoinLinkRow[]> {
  const { data, error } = await supabaseAdmin().from('join_link').select('*').eq('revoked', false);
  if (error) throw new Error(error.message);
  return (data ?? []) as JoinLinkRow[];
}

export async function revokeLink(id: string): Promise<void> {
  const { error } = await supabaseAdmin().from('join_link').update({ revoked: true }).eq('id', id);
  if (error) throw new Error(error.message);
}
