import { eq, and, like, sql } from 'drizzle-orm';
import { marketplaceAgents, marketplaceInstalls } from '$server/db/schema';
import { newId, nowMs } from '$server/db/utils';
import type { TenantContext } from './base';

export interface MarketplaceAgentRecord {
  id: string;
  name: string;
  role: string;
  category: string;
  tags: string;
  description: string;
  catchphrase: string | null;
  version: string;
  model: string | null;
  avatarSeed: string;
  githubPath: string;
  soulMd: string | null;
  identityMd: string | null;
  userMd: string | null;
  contextMd: string | null;
  skillsMd: string | null;
  installCount: number | null;
  syncedAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface MarketplaceAgentUpsert {
  id: string;
  name: string;
  role: string;
  category: string;
  tags: string[];
  description: string;
  catchphrase?: string;
  version: string;
  model?: string;
  avatarSeed: string;
  githubPath: string;
  soulMd?: string;
  identityMd?: string;
  userMd?: string;
  contextMd?: string;
  skillsMd?: string;
}

export interface MarketplaceFilters {
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listMarketplaceAgents(db: TenantContext['db'], filters: MarketplaceFilters = {}) {
  const { category, search, limit = 50, offset = 0 } = filters;

  let query = db.select({
    id: marketplaceAgents.id,
    name: marketplaceAgents.name,
    role: marketplaceAgents.role,
    category: marketplaceAgents.category,
    tags: marketplaceAgents.tags,
    description: marketplaceAgents.description,
    catchphrase: marketplaceAgents.catchphrase,
    version: marketplaceAgents.version,
    model: marketplaceAgents.model,
    avatarSeed: marketplaceAgents.avatarSeed,
    githubPath: marketplaceAgents.githubPath,
    installCount: marketplaceAgents.installCount,
    syncedAt: marketplaceAgents.syncedAt,
    createdAt: marketplaceAgents.createdAt,
    updatedAt: marketplaceAgents.updatedAt,
  }).from(marketplaceAgents).$dynamic();

  if (category) {
    query = query.where(eq(marketplaceAgents.category, category));
  }

  if (search) {
    const pattern = `%${search}%`;
    query = query.where(
      sql`(${marketplaceAgents.name} LIKE ${pattern} OR ${marketplaceAgents.role} LIKE ${pattern} OR ${marketplaceAgents.description} LIKE ${pattern} OR ${marketplaceAgents.tags} LIKE ${pattern})`
    );
  }

  const rows = await query.limit(limit).offset(offset).orderBy(marketplaceAgents.installCount);
  return rows;
}

export async function getMarketplaceAgent(db: TenantContext['db'], id: string) {
  const rows = await db
    .select()
    .from(marketplaceAgents)
    .where(eq(marketplaceAgents.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertMarketplaceAgents(db: TenantContext['db'], agents: MarketplaceAgentUpsert[]) {
  const now = nowMs();
  const results: { id: string; ok: boolean }[] = [];

  for (const a of agents) {
    try {
      await db
        .insert(marketplaceAgents)
        .values({
          id: a.id,
          name: a.name,
          role: a.role,
          category: a.category,
          tags: JSON.stringify(a.tags),
          description: a.description,
          catchphrase: a.catchphrase ?? null,
          version: a.version,
          model: a.model ?? null,
          avatarSeed: a.avatarSeed,
          githubPath: a.githubPath,
          soulMd: a.soulMd ?? null,
          identityMd: a.identityMd ?? null,
          userMd: a.userMd ?? null,
          contextMd: a.contextMd ?? null,
          skillsMd: a.skillsMd ?? null,
          installCount: 0,
          syncedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: marketplaceAgents.id,
          set: {
            name: a.name,
            role: a.role,
            category: a.category,
            tags: JSON.stringify(a.tags),
            description: a.description,
            catchphrase: a.catchphrase ?? null,
            version: a.version,
            model: a.model ?? null,
            avatarSeed: a.avatarSeed,
            githubPath: a.githubPath,
            soulMd: a.soulMd ?? null,
            identityMd: a.identityMd ?? null,
            userMd: a.userMd ?? null,
            contextMd: a.contextMd ?? null,
            skillsMd: a.skillsMd ?? null,
            syncedAt: now,
            updatedAt: now,
          },
        });
      results.push({ id: a.id, ok: true });
    } catch (err) {
      results.push({ id: a.id, ok: false });
    }
  }

  return results;
}

export async function recordInstall(ctx: TenantContext, agentId: string, serverId: string) {
  const now = nowMs();
  const id = newId();

  await ctx.db
    .insert(marketplaceInstalls)
    .values({
      id,
      tenantId: ctx.tenantId,
      agentId,
      serverId,
      installedAt: now,
    });

  // Increment install count
  await ctx.db
    .update(marketplaceAgents)
    .set({ installCount: sql`${marketplaceAgents.installCount} + 1` })
    .where(eq(marketplaceAgents.id, agentId));

  return id;
}

export async function getInstallCountForTenant(ctx: TenantContext, agentId: string) {
  const rows = await ctx.db
    .select({ id: marketplaceInstalls.id })
    .from(marketplaceInstalls)
    .where(
      and(
        eq(marketplaceInstalls.tenantId, ctx.tenantId),
        eq(marketplaceInstalls.agentId, agentId),
      )
    );
  return rows.length;
}
