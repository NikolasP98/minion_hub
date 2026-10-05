import { eq, sql } from 'drizzle-orm';
import { marketplaceAgents } from '@minion-stack/db/pg';
import { z } from 'zod';
import { marketplaceFileLoadState } from '$server/db/pg-marketplace-schema';
import { decodeGitHubFile, githubJson, MarketplaceGitHubError, safeDirectory } from './github';
import type { CatalogTx, MarketplaceAgentUpsert } from './types';

const metadata = z.object({
  id: z.string().min(1).max(128).refine(safeDirectory),
  name: z.string().min(1).max(256),
  role: z.string().max(256),
  category: z.string().max(64),
  tags: z.array(z.string().max(64)).max(50).default([]),
  description: z.string().max(4096),
  catchphrase: z.string().max(1024).optional(),
  version: z.string().min(1).max(128),
  model: z.string().max(128).optional(),
  archetype: z.string().max(128).optional(),
  avatarSeed: z.string().max(128),
});
export async function catalogDirectories(signal: AbortSignal): Promise<string[]> {
  const value = await githubJson('agents', 2 * 1024 * 1024, signal);
  if (!Array.isArray(value) || value.length >= 1000)
    throw new MarketplaceGitHubError('invalid_document');
  const directories: string[] = [];
  for (const entry of value) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof entry.name !== 'string' ||
      !safeDirectory(entry.name) ||
      entry.path !== `agents/${entry.name}` ||
      !['dir', 'file', 'symlink', 'submodule'].includes(entry.type)
    )
      throw new MarketplaceGitHubError('invalid_document');
    if (entry.type === 'dir') directories.push(entry.name);
  }
  if (new Set(directories).size !== directories.length)
    throw new MarketplaceGitHubError('invalid_document');
  return directories.sort();
}
export async function fetchMetadata(
  directory: string,
  signal: AbortSignal,
): Promise<MarketplaceAgentUpsert> {
  const path = `agents/${directory}/agent.json`;
  const text = decodeGitHubFile(await githubJson(path, 64 * 1024, signal), path, 32 * 1024);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new MarketplaceGitHubError('invalid_document');
  }
  const result = metadata.safeParse(parsed);
  if (!result.success) throw new MarketplaceGitHubError('invalid_document');
  return {
    ...result.data,
    archetype: result.data.archetype === 'autonomous' ? 'autonomous' : 'copilot',
    githubPath: `agents/${directory}`,
  };
}

/** Caller owns a bounded transaction; catalog lock always precedes hydration lock. */
export async function upsertMetadata(tx: CatalogTx, agent: MarketplaceAgentUpsert) {
  const [before] = await tx
    .select({
      version: marketplaceAgents.version,
      path: marketplaceAgents.githubPath,
    })
    .from(marketplaceAgents)
    .where(eq(marketplaceAgents.id, agent.id))
    .for('update');
  const changed = before && (before.version !== agent.version || before.path !== agent.githubPath);
  const values = {
    ...agent,
    tags: JSON.stringify(agent.tags),
    catchphrase: agent.catchphrase ?? null,
    model: agent.model ?? null,
    archetype: agent.archetype ?? 'copilot',
    syncedAt: sql`clock_timestamp()`,
    updatedAt: sql`clock_timestamp()`,
  };
  await tx
    .insert(marketplaceAgents)
    .values(values)
    .onConflictDoUpdate({
      target: marketplaceAgents.id,
      set: {
        ...values,
        filesLoadedAt: sql`CASE WHEN ${marketplaceAgents.version} IS DISTINCT FROM excluded.version OR ${marketplaceAgents.githubPath} IS DISTINCT FROM excluded.github_path THEN NULL ELSE ${marketplaceAgents.filesLoadedAt} END`,
      },
    });
  // Upsert above holds the row lock. Invalidation clears obsolete owners but keeps
  // the last verified bundle available to readers until its replacement commits.
  if (changed)
    await tx
      .update(marketplaceFileLoadState)
      .set({
        leaseToken: null,
        leaseUntil: null,
        nextEligibleAt: sql`clock_timestamp()`,
        errorCode: null,
      })
      .where(eq(marketplaceFileLoadState.agentId, agent.id));
}
