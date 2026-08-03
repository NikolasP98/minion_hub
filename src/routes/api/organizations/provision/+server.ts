import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$server/auth/authorize';
import { provisionOrganization } from '$server/services/organization-provision.service';
import { supabaseAdmin } from '$server/supabase';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const POST: RequestHandler = async (event) => {
  const user = requireAdmin(event.locals);
  if (!user.supabaseId) throw error(409, 'A Supabase profile is required to own the organization');

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }
  const b = body as {
    name?: unknown;
    kind?: unknown;
    ownerProfileId?: unknown;
    existingWorkforceCompanyId?: unknown;
    organizationId?: unknown;
  };

  // Heal mode: re-run provisioning for an EXISTING org. Name/kind/owner come
  // from the DB so a page refresh (or a different admin) can always retry.
  if (b.organizationId !== undefined && b.organizationId !== null && b.organizationId !== '') {
    if (typeof b.organizationId !== 'string' || !UUID_RE.test(b.organizationId)) {
      throw error(400, 'organizationId must be a valid UUID');
    }
    const admin = supabaseAdmin();
    const [{ data: org, error: orgError }, { data: owner }] = await Promise.all([
      admin
        .from('organizations')
        .select('id, name, kind')
        .eq('id', b.organizationId)
        .maybeSingle(),
      admin
        .from('member_roles')
        .select('profile_id')
        .eq('org_id', b.organizationId)
        .eq('role_key', 'owner')
        .limit(1)
        .maybeSingle(),
    ]);
    if (orgError) throw error(502, `Organization lookup failed: ${orgError.message}`);
    if (!org) throw error(404, 'Organization not found');
    b.name = (org as { name: string }).name;
    b.kind = (org as { kind: string | null }).kind ?? 'business';
    b.ownerProfileId =
      (owner as { profile_id: string } | null)?.profile_id ?? b.ownerProfileId ?? undefined;
  }

  // An admin may provision on behalf of another profile; default is themselves.
  let ownerProfileId = user.supabaseId;
  if (b.ownerProfileId !== undefined && b.ownerProfileId !== null && b.ownerProfileId !== '') {
    if (typeof b.ownerProfileId !== 'string' || !UUID_RE.test(b.ownerProfileId)) {
      throw error(400, 'ownerProfileId must be a valid profile UUID');
    }
    const { data, error: lookupError } = await supabaseAdmin()
      .from('profiles')
      .select('id')
      .eq('id', b.ownerProfileId)
      .maybeSingle();
    if (lookupError) throw error(502, `Owner profile lookup failed: ${lookupError.message}`);
    if (!data) throw error(400, 'Owner profile not found');
    ownerProfileId = b.ownerProfileId;
  }

  let result;
  try {
    result = await provisionOrganization(event, {
      name: b.name as string,
      profileId: ownerProfileId,
      kind: b.kind,
      existingWorkforceCompanyId: b.existingWorkforceCompanyId as string | undefined,
    });
  } catch (cause) {
    throw error(400, cause instanceof Error ? cause.message : 'Invalid organization request');
  }
  return json(result, { status: result.ok ? 200 : 502 });
};
