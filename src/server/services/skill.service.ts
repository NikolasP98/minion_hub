import { eq, and, sql } from 'drizzle-orm';
import { skills } from '@minion-stack/db/schema';
import { cached, invalidateTags, keys, tags } from '@minion-stack/cache';
import { nowMs } from '$server/db/utils';
import type { TenantContext } from './base';

export interface SkillInput {
  skill_key: string;
  name: string;
  description?: string | null;
  emoji?: string | null;
  bundled?: boolean;
  disabled?: boolean;
  eligible?: boolean;
  [key: string]: unknown;
}

const BATCH_SIZE = 100;

export async function upsertSkills(ctx: TenantContext, serverId: string, items: SkillInput[]) {
  if (items.length === 0) return;
  const now = nowMs();

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    await ctx.db
      .insert(skills)
      .values(
        batch.map((s) => ({
          skillKey: s.skill_key,
          serverId,
          tenantId: ctx.tenantId,
          name: s.name,
          description: s.description ?? null,
          emoji: s.emoji ?? null,
          bundled: s.bundled ?? false,
          disabled: s.disabled ?? false,
          eligible: s.eligible ?? false,
          rawJson: JSON.stringify(s),
          lastSeenAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [skills.skillKey, skills.serverId],
        set: {
          name: sql`excluded.name`,
          description: sql`excluded.description`,
          emoji: sql`excluded.emoji`,
          bundled: sql`excluded.bundled`,
          disabled: sql`excluded.disabled`,
          eligible: sql`excluded.eligible`,
          rawJson: sql`excluded.raw_json`,
          lastSeenAt: now,
        },
      });
  }

  // Skills change only on gateway sync (upsert) — drop the read-aside entries so
  // the next listSkills reflects the fresh catalog.
  await invalidateTags(tags.tenantDomain(ctx.tenantId, 'skills'));
}

export async function listSkills(ctx: TenantContext, serverId: string) {
  return cached(
    keys.hub('skills', { t: ctx.tenantId, d: { serverId } }),
    {
      ttl: '1h',
      swr: '5m',
      tags: tags.tenantDomain(ctx.tenantId, 'skills'),
    },
    async () => {
      const rows = await ctx.db
        .select({ rawJson: skills.rawJson })
        .from(skills)
        .where(and(eq(skills.serverId, serverId), eq(skills.tenantId, ctx.tenantId)));

      return rows.map((r) => JSON.parse(r.rawJson));
    },
  );
}
