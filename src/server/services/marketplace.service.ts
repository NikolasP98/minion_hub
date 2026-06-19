import { eq, and, sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { marketplaceAgents, marketplaceInstalls } from '@minion-stack/db/pg';
import { cached, invalidateTags, keys, tags } from '@minion-stack/cache';
import { newId } from '$server/db/utils';
import { getCoreDb } from '$server/db/pg-client';
import { withOrgCore } from '$server/db/with-org-core';
import { resolveGatewayId } from '$server/services/gateway.pg.service';
import type { CoreCtx } from '$server/auth/core-ctx';
import { scopeData } from './base';

/** The relational-core (Supabase-Postgres) db handle — see `getCoreDb`. */
type CoreDb = ReturnType<typeof getCoreDb>;

/**
 * The marketplace catalog is a single GLOBAL dataset (not tenant-scoped), so it
 * uses a global invalidation tag shared by every reader.
 */
const MARKETPLACE_TAGS = tags.global('marketplace');

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
  // Postgres `timestamp` columns surface as Date (and serialise to ISO strings
  // over the API — the frontend feeds them to `new Date()`, which accepts both).
  syncedAt: Date;
  filesLoadedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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
  try {
    return decodeBase64(f.content);
  } catch {
    return undefined;
  }
}

// ─── Sync (metadata only) ────────────────────────────────────────────────────

export async function syncMarketplaceAgents(
  db: CoreDb,
): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];
  const agents: MarketplaceAgentUpsert[] = [];

  const contents = (await fetchGitHubJson(`repos/${GITHUB_REPO}/contents/agents`)) as Array<{
    name: string;
    type: string;
    path: string;
  }>;

  const dirs = contents.filter((c) => c.type === 'dir');

  await Promise.all(
    dirs.map(async (dir) => {
      try {
        const basePath = `repos/${GITHUB_REPO}/contents/agents/${dir.name}`;
        const agentFile = (await fetchGitHubJson(`${basePath}/agent.json`)) as {
          content?: string;
          encoding?: string;
        };

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
export async function isCatalogStale(db: CoreDb): Promise<boolean> {
  const rows = await db
    .select({ syncedAt: marketplaceAgents.syncedAt })
    .from(marketplaceAgents)
    .orderBy(sql`${marketplaceAgents.syncedAt} DESC`)
    .limit(1);

  if (rows.length === 0) return true;
  return Date.now() - rows[0].syncedAt.getTime() > CATALOG_TTL_MS;
}

// ─── Lazy file loading ────────────────────────────────────────────────────────

/**
 * Fetches the 5 markdown files for an agent from GitHub and stores them in the DB.
 * Updates filesLoadedAt so subsequent calls skip the fetch.
 */
export async function populateAgentFiles(db: CoreDb, agentId: string): Promise<void> {
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

  await db
    .update(marketplaceAgents)
    .set({
      soulMd: decodeFileResult(soulRes) ?? null,
      identityMd: decodeFileResult(identityRes) ?? null,
      userMd: decodeFileResult(userRes) ?? null,
      contextMd: decodeFileResult(contextRes) ?? null,
      skillsMd: decodeFileResult(skillsRes) ?? null,
      filesLoadedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(marketplaceAgents.id, agentId));
}

/**
 * Returns an agent with all markdown fields, lazily fetching from GitHub if not yet cached.
 */
export async function getAgentWithFiles(
  db: CoreDb,
  id: string,
): Promise<MarketplaceAgentRecord | null> {
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

export async function listMarketplaceAgents(db: CoreDb, filters: MarketplaceFilters = {}) {
  const { category, search, limit = 50, offset = 0 } = filters;

  // Global, read-mostly catalog — cache per filter combination. Invalidated on
  // sync (upsertMarketplaceAgents) and install (recordInstall); short TTL + SWR
  // keeps browse/search snappy without re-scanning the table per keystroke.
  return cached(
    keys.hub('marketplace', { d: scopeData({ category, search, limit, offset }) }),
    {
      ttl: '10m',
      swr: '30m',
      tags: MARKETPLACE_TAGS,
    },
    async () => {
      let query = db
        .select({
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
        })
        .from(marketplaceAgents)
        .$dynamic();

      if (category) {
        query = query.where(eq(marketplaceAgents.category, category));
      }

      if (search) {
        const pattern = `%${search}%`;
        query = query.where(
          sql`(${marketplaceAgents.name} ILIKE ${pattern} OR ${marketplaceAgents.role} ILIKE ${pattern} OR ${marketplaceAgents.description} ILIKE ${pattern} OR ${marketplaceAgents.tags} ILIKE ${pattern})`,
        );
      }

      return query.limit(limit).offset(offset).orderBy(marketplaceAgents.installCount);
    },
  );
}

export async function getMarketplaceAgent(db: CoreDb, id: string) {
  const rows = await db
    .select()
    .from(marketplaceAgents)
    .where(eq(marketplaceAgents.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertMarketplaceAgents(db: CoreDb, agents: MarketplaceAgentUpsert[]) {
  const now = new Date();

  const valuesFor = (a: MarketplaceAgentUpsert) => ({
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
  });

  // Conflict update touches metadata only — never markdown or filesLoadedAt. Uses
  // `excluded.*` so the same statement works for a multi-row insert; the value is
  // identical to the per-row `set` it replaces.
  const conflictUpdate = {
    target: marketplaceAgents.id,
    set: {
      name: sql`excluded.name`,
      role: sql`excluded.role`,
      category: sql`excluded.category`,
      tags: sql`excluded.tags`,
      description: sql`excluded.description`,
      catchphrase: sql`excluded.catchphrase`,
      version: sql`excluded.version`,
      model: sql`excluded.model`,
      avatarSeed: sql`excluded.avatar_seed`,
      githubPath: sql`excluded.github_path`,
      syncedAt: now,
      updatedAt: now,
    },
  };

  // Fast path: one multi-row upsert. The rows are pre-validated upstream and the
  // conflict target is the PK, so a row-level failure is not expected; if the
  // batch does fail, fall back to the per-row loop to isolate the bad row(s) and
  // preserve the original "one bad agent doesn't sink the sync" semantics.
  if (agents.length > 0) {
    try {
      await db
        .insert(marketplaceAgents)
        .values(agents.map(valuesFor))
        .onConflictDoUpdate(conflictUpdate);
      await invalidateTags(MARKETPLACE_TAGS);
      return agents.map((a) => ({ id: a.id, ok: true }));
    } catch {
      // fall through to per-row isolation
    }
  }

  const results: { id: string; ok: boolean }[] = [];
  for (const a of agents) {
    try {
      await db.insert(marketplaceAgents).values(valuesFor(a)).onConflictDoUpdate(conflictUpdate);
      results.push({ id: a.id, ok: true });
    } catch {
      results.push({ id: a.id, ok: false });
    }
  }

  // Catalog metadata changed — drop every cached filter combination.
  await invalidateTags(MARKETPLACE_TAGS);

  return results;
}

// ─── Install tracking ─────────────────────────────────────────────────────────

/**
 * Records a marketplace install. `serverId` is the legacy Turso server id; it's
 * bridged to the Supabase `gateway.id` via `resolveGatewayId`. If no gateway
 * bridges that serverId (e.g. a server not yet migrated to pg), the install-count
 * tracking is skipped — the user-facing install still succeeds — and null is
 * returned.
 */
export async function recordInstall(
  ctx: CoreCtx,
  agentId: string,
  serverId: string,
): Promise<string | null> {
  const gatewayId = await resolveGatewayId(serverId);
  if (!gatewayId) return null;

  const id = newId();

  // marketplace_installs is RLS-enforced + org-scoped → run under withOrgCore so
  // the `app_ledger` role + org GUC enforce isolation server-side.
  await withOrgCore(ctx, (tx) =>
    tx.insert(marketplaceInstalls).values({
      id,
      tenantId: ctx.tenantId,
      agentId,
      gatewayId,
    }),
  );

  // Increment install count on the GLOBAL catalog (marketplace_agents has no
  // tenant_id / `*_org_guc` policy) — must stay on ctx.db; under app_ledger the
  // catalog would be invisible and this update would silently affect zero rows.
  await ctx.db
    .update(marketplaceAgents)
    .set({ installCount: sql`${marketplaceAgents.installCount} + 1` })
    .where(eq(marketplaceAgents.id, agentId));

  // installCount feeds the listing's ordering, but sort-by-installCount tolerates
  // the cache's 10m staleness; busting the global catalog on every install is
  // self-defeating (each install evicts the whole catalog). The sync path
  // (upsertMarketplaceAgents) still busts the tag, so the catalog refreshes there.

  return id;
}

export async function getInstallCountForTenant(ctx: CoreCtx, agentId: string) {
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select({ id: marketplaceInstalls.id })
      .from(marketplaceInstalls)
      .where(
        and(
          eq(marketplaceInstalls.tenantId, ctx.tenantId),
          eq(marketplaceInstalls.agentId, agentId),
        ),
      ),
  );
  return rows.length;
}
