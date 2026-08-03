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
  };

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
