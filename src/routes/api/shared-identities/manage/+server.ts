import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import {
  listIdentitiesForAdmin,
  setAccountType,
  setIdentityShareable,
} from '$server/services/shared-identity.service';

/** GET /api/shared-identities/manage?profileId=… → { identities } (admin). */
export const GET: RequestHandler = async ({ locals, url }) => {
  requireAdmin(locals);
  const profileId = url.searchParams.get('profileId');
  if (!profileId) throw error(400, 'profileId is required');
  const identities = await listIdentitiesForAdmin(profileId);
  return json({ identities });
};

/**
 * POST /api/shared-identities/manage  (admin)
 *   { kind: 'account_type', profileId, accountType: 'person'|'service' }
 *   { kind: 'shareable',     identityId, shareable: boolean }
 *
 * Admin surface for marking a profile a shared/service account and flipping
 * which of its identities are exposed for subscription.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const b = (await request.json().catch(() => ({}))) as {
    kind?: string;
    profileId?: string;
    accountType?: string;
    identityId?: string;
    shareable?: boolean;
  };

  try {
    if (b.kind === 'account_type') {
      if (!b.profileId) throw error(400, 'profileId is required');
      if (b.accountType !== 'person' && b.accountType !== 'service') {
        throw error(400, "accountType must be 'person' or 'service'");
      }
      await setAccountType(b.profileId, b.accountType);
      return json({ ok: true });
    }
    if (b.kind === 'shareable') {
      if (!b.identityId) throw error(400, 'identityId is required');
      if (typeof b.shareable !== 'boolean') throw error(400, 'shareable must be a boolean');
      await setIdentityShareable(b.identityId, b.shareable);
      return json({ ok: true });
    }
    throw error(400, "kind must be 'account_type' or 'shareable'");
  } catch (e) {
    // Re-throw SvelteKit HttpErrors untouched; wrap service errors as 400.
    if (e && typeof e === 'object' && 'status' in e) throw e;
    throw error(400, e instanceof Error ? e.message : 'failed');
  }
};
