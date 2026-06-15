import type { TenantContext } from './base';
import { supabaseAdmin } from '$server/supabase';
import { getGoogleCredential } from './identity.service';
import { getGoogleCredentialFromSupabase } from './supabase-credential';
import type { GoogleAdc } from './identity-secrets';

/**
 * Shared / service accounts + per-user identity feed subscriptions.
 *
 * Model (spec 2026-06-15-shared-account-identities-design.md):
 *  - `profiles.account_type` ∈ {'person','service'} classifies an account.
 *  - `user_identities.shareable` marks which of a service account's identities
 *    other org members may pull into their own feed.
 *  - `identity_subscriptions` is the per-user opt-in: (identity, subscriber, org).
 *
 * Availability rule: a user `p` may subscribe to identity `ui` iff
 * `ui.shareable` AND `ui.user_id <> p` AND owner+`p` share an organization.
 * Sharing is org-scoped — never cross-org.
 *
 * All reads/writes go through the service role (`supabaseAdmin`), which bypasses
 * RLS; we enforce ownership/availability here in code, matching user.service.ts.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AvailableSharedIdentity {
  identityId: string;
  provider: string;
  externalId: string;
  displayName: string | null;
  ownerProfileId: string;
  ownerName: string | null;
  organizationId: string;
  subscribed: boolean;
}

/**
 * Shared identities the given subscriber is eligible to opt into, each flagged
 * with whether they're already subscribed. Assembled from a few scoped reads
 * (same style as listUsers) rather than one cross-table join.
 */
export async function listAvailableSharedIdentities(
  subscriberProfileId: string,
): Promise<AvailableSharedIdentity[]> {
  if (!UUID_RE.test(subscriberProfileId)) return [];
  const admin = supabaseAdmin();

  // 1. Orgs the subscriber belongs to.
  const { data: myOrgs, error: myErr } = await admin
    .from('organization_members')
    .select('organization_id')
    .eq('profile_id', subscriberProfileId);
  if (myErr) throw myErr;
  const myOrgIds = [...new Set((myOrgs ?? []).map((m) => (m as { organization_id: string }).organization_id))];
  if (myOrgIds.length === 0) return [];

  // 2. Other members of those orgs (potential owners) + which org each is shared in.
  const { data: coMembers, error: cmErr } = await admin
    .from('organization_members')
    .select('profile_id, organization_id')
    .in('organization_id', myOrgIds);
  if (cmErr) throw cmErr;
  const orgByOwner = new Map<string, string>(); // owner profile → a shared org id
  for (const m of (coMembers ?? []) as Array<{ profile_id: string; organization_id: string }>) {
    if (m.profile_id === subscriberProfileId) continue;
    if (!orgByOwner.has(m.profile_id)) orgByOwner.set(m.profile_id, m.organization_id);
  }
  const ownerIds = [...orgByOwner.keys()];
  if (ownerIds.length === 0) return [];

  // 3. Shareable identities owned by those members.
  const { data: identities, error: idErr } = await admin
    .from('user_identities')
    .select('id, user_id, provider, external_id, display_name')
    .eq('shareable', true)
    .in('user_id', ownerIds);
  if (idErr) throw idErr;
  if (!identities || identities.length === 0) return [];

  // 4. Owner display names + the subscriber's existing subscriptions.
  const [{ data: owners }, { data: subs }] = await Promise.all([
    admin.from('profiles').select('id, display_name').in('id', ownerIds),
    admin
      .from('identity_subscriptions')
      .select('identity_id')
      .eq('subscriber_profile_id', subscriberProfileId),
  ]);
  const ownerName = new Map<string, string | null>(
    ((owners ?? []) as Array<{ id: string; display_name: string | null }>).map((o) => [o.id, o.display_name]),
  );
  const subscribedIds = new Set(
    ((subs ?? []) as Array<{ identity_id: string }>).map((s) => s.identity_id),
  );

  return (identities as Array<{
    id: string;
    user_id: string;
    provider: string;
    external_id: string;
    display_name: string | null;
  }>).map((ui) => ({
    identityId: ui.id,
    provider: ui.provider,
    externalId: ui.external_id,
    displayName: ui.display_name,
    ownerProfileId: ui.user_id,
    ownerName: ownerName.get(ui.user_id) ?? null,
    organizationId: orgByOwner.get(ui.user_id) as string,
    subscribed: subscribedIds.has(ui.id),
  }));
}

/** Subscribe the current user to a shared identity (validates availability). */
export async function subscribeToIdentity(
  subscriberProfileId: string,
  identityId: string,
): Promise<void> {
  const available = await listAvailableSharedIdentities(subscriberProfileId);
  const match = available.find((a) => a.identityId === identityId);
  if (!match) {
    // Not shareable, not in a shared org, or owned by the caller.
    throw new Error('identity is not available to subscribe');
  }
  const { error } = await supabaseAdmin()
    .from('identity_subscriptions')
    .upsert(
      {
        identity_id: identityId,
        subscriber_profile_id: subscriberProfileId,
        organization_id: match.organizationId,
      },
      { onConflict: 'identity_id,subscriber_profile_id' },
    );
  if (error) throw error;
}

/** Unsubscribe the current user from a shared identity. Scoped to the caller. */
export async function unsubscribeFromIdentity(
  subscriberProfileId: string,
  identityId: string,
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('identity_subscriptions')
    .delete()
    .eq('subscriber_profile_id', subscriberProfileId)
    .eq('identity_id', identityId);
  if (error) throw error;
}

/**
 * All subscriptions within an org, collapsed to (subscriber → owning service
 * account) edges for the overview graph. One edge per distinct pair even if a
 * subscriber pulls several identities from the same owner.
 */
export async function listOrgSubscriptionEdges(
  ctx: TenantContext,
): Promise<Array<{ subscriberProfileId: string; ownerProfileId: string }>> {
  const admin = supabaseAdmin();
  const { data: subs, error } = await admin
    .from('identity_subscriptions')
    .select('subscriber_profile_id, identity_id')
    .eq('organization_id', ctx.tenantId);
  if (error) throw error;
  const rows = (subs ?? []) as Array<{ subscriber_profile_id: string; identity_id: string }>;
  if (rows.length === 0) return [];

  // Resolve each identity → its owning profile.
  const identityIds = [...new Set(rows.map((r) => r.identity_id))];
  const { data: identities, error: idErr } = await admin
    .from('user_identities')
    .select('id, user_id')
    .in('id', identityIds);
  if (idErr) throw idErr;
  const ownerByIdentity = new Map<string, string>(
    ((identities ?? []) as Array<{ id: string; user_id: string }>).map((i) => [i.id, i.user_id]),
  );

  const seen = new Set<string>();
  const edges: Array<{ subscriberProfileId: string; ownerProfileId: string }> = [];
  for (const r of rows) {
    const owner = ownerByIdentity.get(r.identity_id);
    if (!owner) continue;
    const key = `${r.subscriber_profile_id}->${owner}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ subscriberProfileId: r.subscriber_profile_id, ownerProfileId: owner });
  }
  return edges;
}

export interface AdminIdentityRow {
  id: string;
  provider: string;
  externalId: string;
  displayName: string | null;
  shareable: boolean;
}

/** Admin: a profile's identities with their shareable flag (for the manage UI). */
export async function listIdentitiesForAdmin(profileId: string): Promise<AdminIdentityRow[]> {
  if (!UUID_RE.test(profileId)) return [];
  const { data, error } = await supabaseAdmin()
    .from('user_identities')
    .select('id, provider, external_id, display_name, shareable')
    .eq('user_id', profileId);
  if (error) throw error;
  return ((data ?? []) as Array<{
    id: string;
    provider: string;
    external_id: string;
    display_name: string | null;
    shareable: boolean | null;
  }>).map((r) => ({
    id: r.id,
    provider: r.provider,
    externalId: r.external_id,
    displayName: r.display_name,
    shareable: r.shareable ?? false,
  }));
}

export interface FeedGoogleCredential {
  email: string;
  adc: GoogleAdc;
  shared: boolean;
  ownerName?: string | null;
}

/**
 * Every Google credential a user's feed should pull: their OWN google identity
 * plus each SHARED google identity they hold an active subscription to.
 *
 * This is the pull-time authorization point (spec §4): a shared identity is
 * resolved only while `shareable = true` AND a subscription row exists, so
 * revoking either (admin un-shares, or user unsubscribes) drops it on the next
 * resolve. Returns decrypted ADC blobs — the hub is the sole key holder; the
 * gateway only ever receives the resolved list over the server-token channel.
 */
export async function resolveFeedGoogleCredentials(
  ctx: TenantContext,
  userId: string,
): Promise<FeedGoogleCredential[]> {
  const out: FeedGoogleCredential[] = [];

  const own = await getGoogleCredential(ctx, userId).catch(() => null);
  if (own) out.push({ email: own.email, adc: own.adc, shared: false });

  if (!UUID_RE.test(userId)) return out;
  const admin = supabaseAdmin();

  const { data: subs } = await admin
    .from('identity_subscriptions')
    .select('identity_id')
    .eq('subscriber_profile_id', userId);
  const identityIds = [...new Set(((subs ?? []) as Array<{ identity_id: string }>).map((s) => s.identity_id))];
  if (identityIds.length === 0) return out;

  // Only still-shareable google identities qualify (authorization).
  const { data: ids } = await admin
    .from('user_identities')
    .select('id, user_id')
    .in('id', identityIds)
    .eq('provider', 'google')
    .eq('shareable', true);
  const owners = (ids ?? []) as Array<{ id: string; user_id: string }>;
  if (owners.length === 0) return out;

  const ownerIds = [...new Set(owners.map((o) => o.user_id))];
  const { data: profs } = await admin.from('profiles').select('id, display_name').in('id', ownerIds);
  const nameById = new Map(
    ((profs ?? []) as Array<{ id: string; display_name: string | null }>).map((p) => [p.id, p.display_name]),
  );

  for (const ownerId of ownerIds) {
    const cred = await getGoogleCredentialFromSupabase(ownerId).catch(() => null);
    if (cred) {
      out.push({ email: cred.email, adc: cred.adc, shared: true, ownerName: nameById.get(ownerId) ?? null });
    }
  }
  return out;
}

/** Admin: classify a profile as a person or a shared service account. */
export async function setAccountType(
  profileId: string,
  accountType: 'person' | 'service',
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('profiles')
    .update({ account_type: accountType, updated_at: new Date().toISOString() })
    .eq('id', profileId);
  if (error) throw error;
}

/**
 * Admin: flip an identity's shareable flag. Guard — an identity may only be made
 * shareable when its owner is a `service` account (so personal identities can't
 * be exposed). Turning it OFF also removes any subscriptions to it (revocation).
 */
export async function setIdentityShareable(
  identityId: string,
  shareable: boolean,
): Promise<void> {
  const admin = supabaseAdmin();
  if (shareable) {
    const { data: ui, error: uiErr } = await admin
      .from('user_identities')
      .select('user_id')
      .eq('id', identityId)
      .maybeSingle();
    if (uiErr) throw uiErr;
    const ownerId = (ui as { user_id: string } | null)?.user_id;
    if (!ownerId) throw new Error('identity not found');
    const { data: owner, error: oErr } = await admin
      .from('profiles')
      .select('account_type')
      .eq('id', ownerId)
      .maybeSingle();
    if (oErr) throw oErr;
    if ((owner as { account_type: string } | null)?.account_type !== 'service') {
      throw new Error('only identities owned by a service account can be made shareable');
    }
  }

  const { error } = await admin
    .from('user_identities')
    .update({ shareable, updated_at: new Date().toISOString() })
    .eq('id', identityId);
  if (error) throw error;

  // Revoke dependent subscriptions when un-sharing (FK has no trigger for this).
  if (!shareable) {
    await admin.from('identity_subscriptions').delete().eq('identity_id', identityId);
  }
}
