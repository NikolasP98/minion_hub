import { and, eq } from 'drizzle-orm';
import { userIdentities } from '../db/schema/user-identities';
import { nowMs } from '../db/utils';
import type { TenantContext } from './base';
import { randomUUID } from 'node:crypto';
import { encryptAdc, decryptAdc, type GoogleAdc } from './identity-secrets';

export type AttachIdentityInput = {
  channel: string;
  channelUserId: string;
  displayName?: string;
  verified: boolean;
};

export async function listIdentities(ctx: TenantContext, userId: string) {
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

/** Decrypt the stored Google ADC for a user (first google identity). */
export async function getGoogleCredential(
  ctx: TenantContext,
  userId: string,
): Promise<{ email: string; adc: GoogleAdc } | null> {
  const rows = await ctx.db
    .select()
    .from(userIdentities)
    .where(and(eq(userIdentities.userId, userId), eq(userIdentities.provider, 'google')));
  const row = rows[0];
  if (!row || !row.secretCiphertext || !row.secretIv) return null;
  return { email: row.externalId, adc: decryptAdc(row.secretCiphertext, row.secretIv) };
}

export async function markVerified(ctx: TenantContext, identityId: string) {
  const now = nowMs();
  await ctx.db
    .update(userIdentities)
    .set({ verifiedAt: now, updatedAt: now })
    .where(eq(userIdentities.id, identityId));
}

export async function removeIdentity(ctx: TenantContext, identityId: string) {
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
