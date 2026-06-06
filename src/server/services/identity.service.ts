import { and, eq } from 'drizzle-orm';
import { userIdentities } from '../db/schema/user-identities';
import { account, user } from '../db/schema/auth';
import { nowMs } from '../db/utils';
import type { TenantContext } from './base';
import { randomUUID } from 'node:crypto';
import { encryptAdc, decryptAdc, type GoogleAdc } from './identity-secrets';
import { getGoogleCredentialFromSupabase } from './supabase-credential';

export type AttachIdentityInput = {
  channel: string;
  channelUserId: string;
  displayName?: string;
  verified: boolean;
};

export async function listIdentities(ctx: TenantContext, userId: string) {
  // Canonical source = Supabase `user_identities` vault (oauth + channel),
  // resolved from the passed legacy id OR supabase uuid. The bridge now keys
  // locals.user.id by profile uuid, so a Turso read (keyed by legacy id) would
  // return nothing; read Supabase first and only fall back to the legacy Turso
  // vault when Supabase yields nothing (bake-in / self-host). Never worse than
  // the pre-cutover behavior.
  const { listOAuthIdentitiesFromSupabase, listChannelIdentitiesFromSupabase } = await import(
    './supabase-credential'
  );
  const [oauth, channel] = await Promise.all([
    listOAuthIdentitiesFromSupabase(userId),
    listChannelIdentitiesFromSupabase(userId),
  ]);
  const supa = [
    ...oauth.map((r) => ({
      id: r.id,
      provider: r.provider,
      channel: r.provider,
      externalId: r.externalId,
      channelUserId: r.externalId,
      displayName: r.displayName,
      kind: 'oauth' as const,
      verifiedAt: r.verifiedAt,
    })),
    ...channel.map((r) => ({
      id: r.id,
      provider: r.channel,
      channel: r.channel,
      externalId: r.channelUserId,
      channelUserId: r.channelUserId,
      displayName: r.displayName,
      kind: 'channel' as const,
      verifiedAt: r.verifiedAt,
    })),
  ];
  if (supa.length > 0) return supa;

  // Legacy fallback: Turso user_identities (keyed by legacy userId).
  const rows = await ctx.db
    .select()
    .from(userIdentities)
    .where(eq(userIdentities.userId, userId));
  // Back-compat aliases (channel/channelUserId) so existing consumers keep
  // working alongside the native provider/kind/externalId fields.
  return rows.map((r) => ({ ...r, channel: r.provider, channelUserId: r.externalId }));
}

/** Backward-compatible: attach a CHANNEL identity (provider=<channel>, kind='channel'). */
export async function attachIdentity(
  ctx: TenantContext,
  userId: string,
  input: AttachIdentityInput,
): Promise<string> {
  const id = randomUUID();
  const now = nowMs();
  await ctx.db.insert(userIdentities).values({
    id,
    userId,
    provider: input.channel,
    kind: 'channel',
    externalId: input.channelUserId,
    displayName: input.displayName ?? null,
    scope: null,
    secretCiphertext: null,
    secretIv: null,
    expiresAt: null,
    verifiedAt: input.verified ? now : null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/** Attach/replace a Google OAuth identity with an encrypted ADC blob. */
export async function attachGoogleIdentity(
  ctx: TenantContext,
  userId: string,
  input: { email: string; adc: GoogleAdc; scope?: string; expiresAt?: number },
): Promise<string> {
  const id = randomUUID();
  const now = nowMs();
  const enc = encryptAdc(input.adc);
  await ctx.db
    .insert(userIdentities)
    .values({
      id,
      userId,
      provider: 'google',
      kind: 'oauth',
      externalId: input.email,
      displayName: input.email,
      scope: input.scope ?? null,
      secretCiphertext: enc.ciphertext,
      secretIv: enc.iv,
      expiresAt: input.expiresAt ?? null,
      verifiedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [userIdentities.provider, userIdentities.externalId],
      set: {
        userId,
        scope: input.scope ?? null,
        secretCiphertext: enc.ciphertext,
        secretIv: enc.iv,
        expiresAt: input.expiresAt ?? null,
        updatedAt: now,
      },
    });
  return id;
}

/**
 * Decrypt the stored Google ADC for a user (first google identity).
 *
 * Source of truth is the canonical Supabase `user_identities` vault (where
 * Supabase logins seal fresh refresh tokens). Falls back to the legacy Turso
 * vault for any credential that hasn't been re-captured via a Supabase login
 * yet — so this is never worse than the pre-Supabase behavior.
 */
export async function getGoogleCredential(
  ctx: TenantContext,
  userId: string,
): Promise<{ email: string; adc: GoogleAdc } | null> {
  const fromSupabase = await getGoogleCredentialFromSupabase(userId);
  if (fromSupabase) return fromSupabase;

  // Legacy fallback: Turso user_identities (keyed by legacy userId).
  const rows = await ctx.db
    .select()
    .from(userIdentities)
    .where(and(eq(userIdentities.userId, userId), eq(userIdentities.provider, 'google')));
  const row = rows[0];
  if (!row || !row.secretCiphertext || !row.secretIv) return null;
  return { email: row.externalId, adc: decryptAdc(row.secretCiphertext, row.secretIv) };
}

/**
 * Mirror a user's Better Auth Google `account` row into `user_identities`
 * (kind='oauth') with an encrypted ADC blob. Called after a successful
 * `linkSocial({provider:'google'})` so the agent-access store is populated.
 *
 * Returns `{ email }` on success, or `null` when the user has no linked
 * Google account or the account lacks a refresh token. Requires
 * GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in the environment.
 */
export async function syncGoogleIdentityFromAccount(
  ctx: TenantContext,
  userId: string,
): Promise<{ email: string } | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set');
  }

  const accountRows = await ctx.db
    .select()
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'google')));
  const acct = accountRows[0];
  if (!acct || !acct.refreshToken) return null;

  const userRows = await ctx.db.select().from(user).where(eq(user.id, userId));
  const email = userRows[0]?.email ?? acct.accountId;

  await attachGoogleIdentity(ctx, userId, {
    email,
    adc: {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: acct.refreshToken,
      type: 'authorized_user',
    },
    scope: acct.scope ?? undefined,
    expiresAt: acct.refreshTokenExpiresAt ? new Date(acct.refreshTokenExpiresAt).getTime() : undefined,
  });

  return { email };
}

export async function markVerified(ctx: TenantContext, identityId: string) {
  const now = nowMs();
  await ctx.db
    .update(userIdentities)
    .set({ verifiedAt: now, updatedAt: now })
    .where(eq(userIdentities.id, identityId));
}

export async function removeIdentity(ctx: TenantContext, identityId: string) {
  // Canonical vault first — listIdentities now serves Supabase rows (Supabase
  // ids), so a Turso-only delete would no-op on them. Fall back to Turso when
  // the id isn't in Supabase (legacy rows / bake-in).
  const { deleteIdentityByIdFromSupabase } = await import('./supabase-credential');
  if (await deleteIdentityByIdFromSupabase(identityId)) return;
  await ctx.db.delete(userIdentities).where(eq(userIdentities.id, identityId));
}

/** Backward-compatible channel lookup → provider+externalId. */
export async function findByChannelKey(ctx: TenantContext, channel: string, channelUserId: string) {
  const rows = await ctx.db
    .select()
    .from(userIdentities)
    .where(and(eq(userIdentities.provider, channel), eq(userIdentities.externalId, channelUserId)));
  return rows[0] ?? null;
}
