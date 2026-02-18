import { eq, and } from 'drizzle-orm';
import { skills } from '$server/db/schema';
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

export async function upsertSkills(ctx: TenantContext, serverId: string, items: SkillInput[]) {
  if (items.length === 0) return;
  const now = nowMs();

  for (const s of items) {
    await ctx.db
      .insert(skills)
      .values({
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
      })
      .onConflictDoUpdate({
        target: [skills.skillKey, skills.serverId],
        set: {
          name: s.name,
          description: s.description ?? null,
          emoji: s.emoji ?? null,
          bundled: s.bundled ?? false,
          disabled: s.disabled ?? false,
          eligible: s.eligible ?? false,
          rawJson: JSON.stringify(s),
          lastSeenAt: now,
        },
      });
  }
}

export async function listSkills(ctx: TenantContext, serverId: string) {
  const rows = await ctx.db
    .select({ rawJson: skills.rawJson })
    .from(skills)
    .where(and(eq(skills.serverId, serverId), eq(skills.tenantId, ctx.tenantId)));

  return rows.map((r) => JSON.parse(r.rawJson));
}
