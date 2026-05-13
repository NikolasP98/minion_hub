import { and, eq } from 'drizzle-orm';
import { channelIdentities } from '../db/schema/channel-identities';
import { nowMs } from '../db/utils';
import type { TenantContext } from './base';
import { randomUUID } from 'node:crypto';

export type AttachIdentityInput = {
  channel: string;
  channelUserId: string;
  displayName?: string;
  verified: boolean;
};

export async function listIdentities(ctx: TenantContext, userId: string) {
  return ctx.db
    .select()
    .from(channelIdentities)
    .where(eq(channelIdentities.userId, userId));
}

export async function attachIdentity(
  ctx: TenantContext,
  userId: string,
  input: AttachIdentityInput,
): Promise<string> {
  const id = randomUUID();
  const now = nowMs();

  await ctx.db.insert(channelIdentities).values({
    id,
    userId,
    channel: input.channel,
    channelUserId: input.channelUserId,
    displayName: input.displayName ?? null,
    verifiedAt: input.verified ? now : null,
    createdAt: now,
  });

  return id;
}

export async function markVerified(ctx: TenantContext, identityId: string) {
  await ctx.db
    .update(channelIdentities)
    .set({ verifiedAt: nowMs() })
    .where(eq(channelIdentities.id, identityId));
}

export async function removeIdentity(ctx: TenantContext, identityId: string) {
  await ctx.db.delete(channelIdentities).where(eq(channelIdentities.id, identityId));
}

export async function findByChannelKey(
  ctx: TenantContext,
  channel: string,
  channelUserId: string,
) {
  const rows = await ctx.db
    .select()
    .from(channelIdentities)
    .where(
      and(
        eq(channelIdentities.channel, channel),
        eq(channelIdentities.channelUserId, channelUserId),
      ),
    );

  return rows[0] ?? null;
}
