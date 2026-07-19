import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { listAvailableSharedIdentities } from '$server/services/shared-identity.service';
import { getGoogleCredential } from '$server/services/identity.service';
import { probeGoogleToken, type GoogleTokenHealth } from '$server/services/google-token-health';
import { getCoreCtx } from '$server/auth/core-ctx';
import {
  getRetentionDays,
  listEntries,
  DEFAULT_RETENTION_DAYS,
} from '$server/services/email-ledger.service';

/** A processed-email ledger row, serialised for the client. */
export interface LedgerRow {
  id: string;
  mailbox: string;
  fromDomain: string | null;
  subject: string | null;
  summary: string | null;
  labels: string[];
  processedAt: string;
}

/**
 * Gmail channel — manage the Google inboxes behind the feed: the signed-in
 * user's own linked Gmail plus every SHARED inbox (service accounts like
 * Faces Sculptors) they may pull into their feed. Each account carries a live
 * token-health probe so a stale/under-scoped link (the silent 403 failure
 * mode) is visible and actionable instead of just "no emails".
 *
 * View access inherits the `/channels` → channels:view route gate. Mutations
 * go through the existing self-scoped /api/shared-identities endpoints.
 */
export interface GmailAccountRow {
  kind: 'own' | 'shared';
  /** user_identities id — null for the own row (nothing to subscribe to). */
  identityId: string | null;
  email: string;
  displayName: string | null;
  /** Shared rows: display name of the owning service account. */
  ownerName: string | null;
  /** Shared rows: whether this inbox is currently in the user's feed. */
  subscribed: boolean;
  health: GoogleTokenHealth | null;
}

export const load: PageServerLoad = async ({ locals, depends }) => {
  depends('app:gmail-accounts');
  if (!locals.tenantCtx || !locals.user) throw error(401, 'authentication required');
  const ctx = locals.tenantCtx;
  const supabaseId = locals.user.supabaseId ?? locals.user.id;

  const orgId = locals.orgId ?? ctx.tenantId;
  const [own, shared] = await Promise.all([
    getGoogleCredential(ctx, supabaseId).catch(() => null),
    listAvailableSharedIdentities(supabaseId, orgId).catch(
      () => [] as Awaited<ReturnType<typeof listAvailableSharedIdentities>>,
    ),
  ]);
  const sharedGoogle = shared.filter((s) => s.provider === 'google');

  // Probe every account's token in parallel; a probe failure renders as
  // "couldn't verify" rather than failing the page.
  const [ownHealth, ...sharedHealth] = await Promise.all([
    own ? probeGoogleToken(own.adc) : Promise.resolve(null),
    ...sharedGoogle.map(async (s) => {
      const cred = await getGoogleCredential(ctx, s.ownerProfileId).catch(() => null);
      return cred ? probeGoogleToken(cred.adc) : null;
    }),
  ]);

  const accounts: GmailAccountRow[] = [];
  if (own) {
    accounts.push({
      kind: 'own',
      identityId: null,
      email: own.email,
      displayName: null,
      ownerName: null,
      subscribed: true,
      health: ownHealth,
    });
  }
  sharedGoogle.forEach((s, i) => {
    accounts.push({
      kind: 'shared',
      identityId: s.identityId,
      email: s.externalId,
      displayName: s.displayName,
      ownerName: s.ownerName,
      subscribed: s.subscribed,
      health: sharedHealth[i] ?? null,
    });
  });

  // Ledger (Supabase-PG, org-scoped): retention setting + recent processed rows.
  const coreCtx = await getCoreCtx(locals);
  const [retentionDays, entries] = coreCtx
    ? await Promise.all([
        getRetentionDays(coreCtx).catch(() => DEFAULT_RETENTION_DAYS),
        listEntries(coreCtx, { limit: 25 }).catch(() => []),
      ])
    : [DEFAULT_RETENTION_DAYS, []];
  const ledger: LedgerRow[] = entries.map((r) => ({
    id: r.id,
    mailbox: r.mailbox,
    fromDomain: r.fromDomain,
    subject: r.subject,
    summary: r.summary,
    labels: r.labels ?? [],
    processedAt: (r.processedAt instanceof Date
      ? r.processedAt
      : new Date(r.processedAt as unknown as string)
    ).toISOString(),
  }));

  return { userId: locals.user.id, accounts, retentionDays, ledger };
};
