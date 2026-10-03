import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { invalidateTags, tags } from '@minion-stack/cache';
import { marketplaceSyncState as state } from '$server/db/pg-marketplace-schema';
import { catalogDirectories, fetchMetadata, upsertMetadata } from './metadata';
import { mapGitHubPage, MarketplaceGitHubError } from './github';
import {
  MarketplaceLeaseLost,
  type CatalogDb,
  type CatalogTx,
  type MarketplaceAgentUpsert,
} from './types';

type State = typeof state.$inferSelect;
export interface SyncResult {
  synced: number;
  errors: string[];
  status: 'busy' | 'not_due' | State['status'];
  failed: number;
  continuation: boolean;
  retryAfterSeconds?: number;
}
export async function limitCatalogTransaction(tx: CatalogTx) {
  await tx.execute(sql`SET LOCAL lock_timeout = '4s'`);
  await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
}
const owned = (token: string) =>
  and(
    eq(state.id, 'catalog'),
    eq(state.leaseToken, token),
    sql`${state.leaseUntil} > clock_timestamp()`,
  );
const summary = (row: State): SyncResult => ({
  synced: row.synced,
  failed: row.failed,
  errors: row.errors,
  status: row.status,
  continuation: row.status === 'running',
});
function retrySeconds(until: Date | null, now: Date) {
  return Math.max(
    1,
    Math.min(120, Math.ceil(((until?.getTime() ?? now.getTime()) - now.getTime()) / 1000)),
  );
}
export async function claimCatalogSync(db: CatalogDb, manual = false) {
  return db.transaction(async (tx) => {
    await limitCatalogTransaction(tx);
    await tx.insert(state).values({ id: 'catalog' }).onConflictDoNothing();
    const [row] = await tx.select().from(state).where(eq(state.id, 'catalog')).for('update');
    const [{ now }] = await tx
      .select({ now: sql<string>`clock_timestamp()::text` })
      .from(state)
      .limit(1);
    const clock = new Date(now);
    if (row.leaseToken && row.leaseUntil && row.leaseUntil > clock)
      return {
        result: {
          ...summary(row),
          status: 'busy' as const,
          retryAfterSeconds: retrySeconds(row.leaseUntil, clock),
        },
      };
    const eligible = manual && row.status !== 'running' ? row.manualEligibleAt : row.nextEligibleAt;
    if (eligible > clock)
      return {
        result: {
          ...summary(row),
          status: 'not_due' as const,
          retryAfterSeconds: retrySeconds(eligible, clock),
        },
      };
    const token = randomUUID();
    const [claimed] = await tx
      .update(state)
      .set({ leaseToken: token, leaseUntil: sql`clock_timestamp() + interval '120 seconds'` })
      .where(eq(state.id, 'catalog'))
      .returning();
    return { row: claimed, token };
  });
}
function failureCode(reason: unknown): string {
  return reason instanceof MarketplaceGitHubError ? reason.code : 'provider_unavailable';
}
function permanentRowFailure(reason: unknown): boolean {
  let current = reason;
  for (let i = 0; i < 5 && current && typeof current === 'object'; i++) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string') return /^(22|23)/.test(candidate.code);
    current = candidate.cause;
  }
  return false;
}
export async function publishCatalogPage(
  db: CatalogDb,
  claim: State,
  token: string,
  directories: string[],
  results: PromiseSettledResult<MarketplaceAgentUpsert>[],
): Promise<SyncResult> {
  try {
    return await db.transaction(async (tx) => {
      await limitCatalogTransaction(tx);
      const [current] = await tx.select().from(state).where(owned(token)).for('update');
      if (!current) throw new MarketplaceLeaseLost();
      const continuing = claim.status === 'running';
      const start = continuing ? claim.nextIndex : 0;
      let synced = continuing ? claim.synced : 0;
      let failed = continuing ? claim.failed : 0;
      const errors = continuing ? [...claim.errors] : [];
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        let code: string | undefined;
        if (result.status === 'rejected') code = failureCode(result.reason);
        else {
          try {
            // Only permanent row validation/constraint failures are isolated. A
            // connection/timeout fault must abort the whole page and preserve cursor.
            await tx.transaction((savepoint) => upsertMetadata(savepoint, result.value));
            synced++;
          } catch (cause) {
            if (!permanentRowFailure(cause)) throw cause;
            code = 'invalid_catalog_row';
          }
        }
        if (code) {
          failed++;
          if (errors.length < 20) errors.push(`${directories[start + i]}: ${code}`.slice(0, 240));
        }
      }
      const nextIndex = start + results.length;
      const done = nextIndex >= directories.length;
      const status = done ? (failed ? 'partial' : 'complete') : 'running';
      const [updated] = await tx
        .update(state)
        .set({
          lastPublishedToken: token,
          leaseToken: null,
          leaseUntil: null,
          directories: done ? [] : directories,
          nextIndex: done ? 0 : nextIndex,
          synced,
          failed,
          errors,
          status,
          cycleStartedAt: continuing ? claim.cycleStartedAt : sql`clock_timestamp()`,
          ...(done
            ? {
                completedAt: sql`clock_timestamp()`,
                lastSynced: synced,
                lastFailed: failed,
                manualEligibleAt: sql`clock_timestamp() + interval '1 minute'`,
              }
            : {}),
          nextEligibleAt: done
            ? failed
              ? sql`clock_timestamp() + interval '5 minutes'`
              : sql`clock_timestamp() + interval '1 hour'`
            : sql`clock_timestamp()`,
        })
        .where(owned(token))
        .returning();
      // Ownership may have expired during a slow page. Throwing rolls back all
      // metadata writes and savepoints, not just the progress mutation.
      if (!updated) throw new MarketplaceLeaseLost();
      return summary(updated);
    });
  } catch (cause) {
    // Commit response loss is not a failed page. This token belongs to one
    // publish attempt; later claims retain it until their own page commits.
    const [canonical] = await db.select().from(state).where(eq(state.id, 'catalog')).limit(1);
    if (canonical?.lastPublishedToken === token) return summary(canonical);
    throw cause;
  }
}

async function failRoot(db: CatalogDb, token: string, reason: unknown): Promise<SyncResult> {
  return db.transaction(async (tx) => {
    await limitCatalogTransaction(tx);
    const [row] = await tx
      .update(state)
      .set({
        leaseToken: null,
        leaseUntil: null,
        directories: [],
        nextIndex: 0,
        synced: 0,
        failed: 0,
        errors: [`catalog: ${failureCode(reason)}`],
        status: 'failed',
        cycleStartedAt: null,
        nextEligibleAt: sql`clock_timestamp() + interval '5 minutes'`,
        manualEligibleAt: sql`clock_timestamp() + interval '1 minute'`,
      })
      .where(owned(token))
      .returning();
    if (!row) throw new MarketplaceLeaseLost();
    return summary(row);
  });
}

/** One request performs one resumable page; no HTTP runs inside a SQL transaction. */
export async function syncMarketplaceAgents(db: CatalogDb, manual = true): Promise<SyncResult> {
  const claim = await claimCatalogSync(db, manual);
  if ('result' in claim) return claim.result!;
  const { row, token } = claim;
  const signal = AbortSignal.timeout(40_000);
  let directories = row.directories;
  if (row.status !== 'running') {
    try {
      directories = await catalogDirectories(signal);
    } catch (cause) {
      const result = await failRoot(db, token, cause);
      console.warn('[marketplace-sync]', {
        cycle: token,
        status: result.status,
        code: failureCode(cause),
      });
      return result;
    }
  }
  const start = row.status === 'running' ? row.nextIndex : 0;
  const results = await mapGitHubPage(directories.slice(start, start + 25), signal, (directory) =>
    fetchMetadata(directory, signal),
  );
  const result = await publishCatalogPage(db, row, token, directories, results);
  // A cache-invalidation outage cannot turn a committed sync into a replayable
  // write failure. The bounded catalog TTL remains the recovery path.
  try {
    await invalidateTags(tags.global('marketplace'));
  } catch {
    console.warn('[marketplace-sync]', { cycle: token, code: 'cache_invalidation_failed' });
  }
  if (result.failed)
    console.warn('[marketplace-sync]', {
      cycle: token,
      status: result.status,
      failed: result.failed,
    });
  return result;
}
