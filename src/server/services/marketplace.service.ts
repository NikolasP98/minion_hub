import { eq, and, sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { marketplaceAgents, marketplaceInstalls } from '$server/db/schema';
import { newId, nowMs } from '$server/db/utils';
import type { TenantContext } from './base';

const GITHUB_REPO = 'NikolasP98/minions';
const GITHUB_API = 'https://api.github.com';

/** TTL for the marketplace catalog cache: 1 hour in milliseconds */
const CATALOG_TTL_MS = 60 * 60 * 1000;

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
  filesLoadedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** Metadata-only upsert — no markdown fields, those are lazy-loaded */
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
}

export interface MarketplaceFilters {
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

// ─── GitHub helpers ───────────────────────────────────────────────────────────

async function fetchGitHubJson(path: string): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'minion-hub',
  };
  if (env.GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${env.GITHUB_TOKEN}`;
  }
  const res = await fetch(`${GITHUB_API}/${path}`, { headers });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${path}`);
  return res.json();
}

function decodeBase64(encoded: string): string {
  const clean = encoded.replace(/\n/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

function decodeFileResult(res: PromiseSettledResult<unknown>): string | undefined {
  if (res.status !== 'fulfilled') return undefined;
  const f = res.value as { content?: string };
  if (!f.content) return undefined;
  try { return decodeBase64(f.content); } catch { return undefined; }
}

// ─── Sync (metadata only) ────────────────────────────────────────────────────

export async function syncMarketplaceAgents(db: TenantContext['db']): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];
  const agents: MarketplaceAgentUpsert[] = [];

  const contents = await fetchGitHubJson(`repos/${GITHUB_REPO}/contents/agents`) as Array<{
    name: string;
    type: string;
    path: string;
  }>;

  const dirs = contents.filter((c) => c.type === 'dir');

  await Promise.all(
    dirs.map(async (dir) => {
      try {
        const basePath = `repos/${GITHUB_REPO}/contents/agents/${dir.name}`;
        const agentFile = await fetchGitHubJson(`${basePath}/agent.json`) as { content?: string; encoding?: string };

        if (!agentFile.content) {
          errors.push(`${dir.name}: empty agent.json`);
          return;
        }

        const agentJson = JSON.parse(decodeBase64(agentFile.content)) as {
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
        };

        agents.push({
          id: agentJson.id,
          name: agentJson.name,
          role: agentJson.role,
          category: agentJson.category,
          tags: agentJson.tags ?? [],
          description: agentJson.description,
          catchphrase: agentJson.catchphrase,
          version: agentJson.version,
          model: agentJson.model,
          avatarSeed: agentJson.avatarSeed,
          githubPath: `agents/${dir.name}`,
        });
      } catch (err) {
        errors.push(`${dir.name}: ${(err as Error).message}`);
      }
    }),
  );

  const results = await upsertMarketplaceAgents(db, agents);
  const synced = results.filter((r) => r.ok).length;
  return { synced, errors };
}

/**
 * Returns true if the catalog is stale and should be re-synced.
 * Checks the most recently synced row; if none exist or the row is older than CATALOG_TTL_MS, returns true.
 */
export async function isCatalogStale(db: TenantContext['db']): Promise<boolean> {
  const rows = await db
    .select({ syncedAt: marketplaceAgents.syncedAt })
    .from(marketplaceAgents)
    .orderBy(sql`${marketplaceAgents.syncedAt} DESC`)
    .limit(1);

  if (rows.length === 0) return true;
  return Date.now() - rows[0].syncedAt > CATALOG_TTL_MS;
}

// ─── Lazy file loading ────────────────────────────────────────────────────────

/**
 * Fetches the 5 markdown files for an agent from GitHub and stores them in SQLite.
 * Updates filesLoadedAt so subsequent calls skip the fetch.
 */
export async function populateAgentFiles(db: TenantContext['db'], agentId: string): Promise<void> {
  const rows = await db
    .select({ githubPath: marketplaceAgents.githubPath })
    .from(marketplaceAgents)
    .where(eq(marketplaceAgents.id, agentId))
    .limit(1);

  if (!rows[0]) return;
  const basePath = `repos/${GITHUB_REPO}/contents/${rows[0].githubPath}`;

  const [soulRes, identityRes, userRes, contextRes, skillsRes] = await Promise.allSettled([
    fetchGitHubJson(`${basePath}/SOUL.md`),
    fetchGitHubJson(`${basePath}/IDENTITY.md`),
    fetchGitHubJson(`${basePath}/USER.md`),
    fetchGitHubJson(`${basePath}/CONTEXT.md`),
    fetchGitHubJson(`${basePath}/SKILLS.md`),
  ]);

  const now = nowMs();
  await db
    .update(marketplaceAgents)
    .set({
      soulMd: decodeFileResult(soulRes) ?? null,
      identityMd: decodeFileResult(identityRes) ?? null,
      userMd: decodeFileResult(userRes) ?? null,
      contextMd: decodeFileResult(contextRes) ?? null,
      skillsMd: decodeFileResult(skillsRes) ?? null,
      filesLoadedAt: now,
      updatedAt: now,
    })
    .where(eq(marketplaceAgents.id, agentId));
}

/**
 * Returns an agent with all markdown fields, lazily fetching from GitHub if not yet cached.
 */
export async function getAgentWithFiles(db: TenantContext['db'], id: string): Promise<MarketplaceAgentRecord | null> {
  const rows = await db
    .select()
    .from(marketplaceAgents)
    .where(eq(marketplaceAgents.id, id))
    .limit(1);

  const agent = rows[0] ?? null;
  if (!agent) return null;

  if (!agent.filesLoadedAt) {
    await populateAgentFiles(db, id);
    // Re-fetch with populated files
    const updated = await db
      .select()
      .from(marketplaceAgents)
      .where(eq(marketplaceAgents.id, id))
      .limit(1);
    return updated[0] ?? null;
  }

  return agent;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

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
          // Markdown is null on initial insert; lazily populated on first detail view
          soulMd: null,
          identityMd: null,
          userMd: null,
          contextMd: null,
          skillsMd: null,
          installCount: 0,
          syncedAt: now,
          filesLoadedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: marketplaceAgents.id,
          set: {
            // Update metadata fields only; do NOT touch markdown or filesLoadedAt
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

// ─── Install tracking ─────────────────────────────────────────────────────────

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
