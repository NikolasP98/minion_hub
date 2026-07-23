import { and, eq, inArray } from 'drizzle-orm';
import type { IngestRow } from './messages.service';
import { bgJobs } from '$server/db/pg-schema/bg-jobs';
import { getCoreDb } from '$server/db/pg-client';
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  advanceJob,
  enqueueJob,
  registerJobHandler,
  type AdvanceResult,
  type BgJob,
} from './bg-runtime';
import {
  backfillWhatsAppConversations,
  markWhatsAppSourceFailure,
  syncWhatsAppConversation,
} from './brain-corpus.service';

export const BRAIN_CORPUS_JOB_TYPE = 'brain_corpus_whatsapp';
const RECONCILE_REF = 'whatsapp:reconcile';
const DIRTY_REF = 'whatsapp:dirty';
const RECONCILE_BATCH = 25;

export interface DirtyWhatsAppConversation {
  accountId: string;
  chatId: string;
  /** Empty means the event lacked a trustworthy timestamp; rescan all months. */
  months: string[];
}

interface DirtyCursor {
  kind: 'dirty';
  conversations: DirtyWhatsAppConversation[];
  next: number;
  /** Durable, bounded failure notes accumulated while later items continue. */
  failures: string[];
}

interface ReconcileCursor {
  kind: 'reconcile';
  cursor: string | null;
  processed: number;
  changedChunks: number;
  embeddedChunks: number;
}

type BrainCorpusCursor = DirtyCursor | ReconcileCursor;

type DirtyIngestRow = Pick<
  IngestRow,
  'channel' | 'accountId' | 'chatId' | 'isGroup' | 'isBot' | 'content'
> & { occurredAt?: number | null };

export function collectDirtyWhatsAppConversations(
  rows: DirtyIngestRow[],
): DirtyWhatsAppConversation[] {
  const unique = new Map<string, DirtyWhatsAppConversation>();
  for (const row of rows) {
    if (row.channel !== 'whatsapp') continue;
    if (row.isGroup === true || row.isBot === true) continue;
    if (!row.accountId?.trim() || !row.chatId?.trim() || !row.content?.trim()) continue;
    const accountId = row.accountId.trim();
    const chatId = row.chatId.trim();
    const key = `${accountId}\u0000${chatId}`;
    const existing = unique.get(key);
    const occurredAt = typeof row.occurredAt === 'number' ? new Date(row.occurredAt) : null;
    const month =
      occurredAt && !Number.isNaN(occurredAt.getTime())
        ? occurredAt.toISOString().slice(0, 7)
        : null;
    // An unknown timestamp requires a full conversation scan and dominates
    // any narrower month hints collected from the same ingest batch.
    const months =
      !month || existing?.months.length === 0
        ? []
        : [...new Set([...(existing?.months ?? []), month])].sort();
    unique.set(key, { accountId, chatId, months });
  }
  return [...unique.values()].sort(
    (a, b) => a.accountId.localeCompare(b.accountId) || a.chatId.localeCompare(b.chatId),
  );
}

export async function enqueueWhatsAppBrainChanges(
  orgId: string,
  rows: DirtyIngestRow[],
): Promise<string | null> {
  const conversations = collectDirtyWhatsAppConversations(rows);
  if (conversations.length === 0) return null;
  const db = getCoreDb();
  const [queued] = await db
    .select({ id: bgJobs.id, cursor: bgJobs.cursor })
    .from(bgJobs)
    .where(
      and(
        eq(bgJobs.tenantId, orgId),
        eq(bgJobs.type, BRAIN_CORPUS_JOB_TYPE),
        eq(bgJobs.refId, DIRTY_REF),
        eq(bgJobs.status, 'queued'),
      ),
    )
    .limit(1);
  if (queued?.cursor) {
    try {
      const current = parseCursor({ cursor: queued.cursor } as BgJob);
      if (current.kind === 'dirty') {
        const merged = mergeDirtyWhatsAppConversations([
          ...current.conversations.slice(current.next),
          ...conversations,
        ]);
        const updated = await db
          .update(bgJobs)
          .set({
            cursor: JSON.stringify({
              kind: 'dirty',
              conversations: merged,
              next: 0,
              failures: current.failures,
            } satisfies DirtyCursor),
            updatedAt: Date.now(),
          })
          .where(
            and(
              eq(bgJobs.id, queued.id),
              eq(bgJobs.status, 'queued'),
              eq(bgJobs.cursor, queued.cursor),
            ),
          )
          .returning({ id: bgJobs.id });
        if (updated.length > 0) return queued.id;
      }
    } catch {
      // A malformed/claimed row is not safe to mutate; enqueue a fresh repair.
    }
  }
  return enqueueJob({
    tenantId: orgId,
    type: BRAIN_CORPUS_JOB_TYPE,
    refId: DIRTY_REF,
    cursor: { kind: 'dirty', conversations, next: 0, failures: [] } satisfies DirtyCursor,
  });
}

export function mergeDirtyWhatsAppConversations(
  conversations: DirtyWhatsAppConversation[],
): DirtyWhatsAppConversation[] {
  const merged = new Map<string, DirtyWhatsAppConversation>();
  for (const item of conversations) {
    const key = `${item.accountId}\u0000${item.chatId}`;
    const current = merged.get(key);
    const months = !current
      ? [...item.months]
      : current.months.length === 0 || item.months.length === 0
        ? []
        : [...new Set([...current.months, ...item.months])].sort();
    merged.set(key, { accountId: item.accountId, chatId: item.chatId, months });
  }
  return [...merged.values()].sort(
    (a, b) => a.accountId.localeCompare(b.accountId) || a.chatId.localeCompare(b.chatId),
  );
}

export async function ensureWhatsAppReconcileJob(
  orgId: string,
): Promise<{ jobId: string; created: boolean }> {
  const db = getCoreDb();
  const [active] = await db
    .select({ id: bgJobs.id })
    .from(bgJobs)
    .where(
      and(
        eq(bgJobs.tenantId, orgId),
        eq(bgJobs.type, BRAIN_CORPUS_JOB_TYPE),
        eq(bgJobs.refId, RECONCILE_REF),
        inArray(bgJobs.status, ['queued', 'running']),
      ),
    )
    .limit(1);
  if (active) return { jobId: active.id, created: false };
  const jobId = await enqueueJob({
    tenantId: orgId,
    type: BRAIN_CORPUS_JOB_TYPE,
    refId: RECONCILE_REF,
    cursor: {
      kind: 'reconcile',
      cursor: null,
      processed: 0,
      changedChunks: 0,
      embeddedChunks: 0,
    } satisfies ReconcileCursor,
  });
  return { jobId, created: true };
}

function parseCursor(job: BgJob): BrainCorpusCursor {
  if (!job.cursor) throw new Error('brain corpus job is missing its durable cursor');
  const value = JSON.parse(job.cursor) as Partial<BrainCorpusCursor>;
  if (value.kind === 'dirty' && Array.isArray(value.conversations)) {
    return {
      kind: 'dirty',
      conversations: value.conversations
        .filter(
          (item): item is DirtyWhatsAppConversation =>
            typeof item?.accountId === 'string' && typeof item?.chatId === 'string',
        )
        .map((item) => ({
          accountId: item.accountId,
          chatId: item.chatId,
          months: Array.isArray(item.months)
            ? item.months.filter(
                (month): month is string =>
                  typeof month === 'string' && /^\d{4}-\d{2}$/.test(month),
              )
            : [],
        })),
      next: Math.max(0, Number(value.next) || 0),
      failures: Array.isArray(value.failures)
        ? value.failures
            .filter((failure): failure is string => typeof failure === 'string')
            .slice(-20)
        : [],
    };
  }
  if (value.kind === 'reconcile') {
    return {
      kind: 'reconcile',
      cursor: typeof value.cursor === 'string' ? value.cursor : null,
      processed: Math.max(0, Number(value.processed) || 0),
      changedChunks: Math.max(0, Number(value.changedChunks) || 0),
      embeddedChunks: Math.max(0, Number(value.embeddedChunks) || 0),
    };
  }
  throw new Error('brain corpus job has an invalid cursor');
}

export async function advanceBrainCorpusJob(job: BgJob): Promise<AdvanceResult> {
  const cursor = parseCursor(job);
  const ctx: CoreCtx = { db: getCoreDb(), tenantId: job.tenantId };
  if (cursor.kind === 'dirty') {
    const conversation = cursor.conversations[cursor.next];
    if (!conversation) {
      return {
        done: true,
        error: cursor.failures.length > 0 ? cursor.failures.join('; ') : undefined,
      };
    }
    let failure: string | null = null;
    try {
      await syncWhatsAppConversation(ctx, conversation.accountId, conversation.chatId, {
        months: conversation.months,
      });
    } catch (cause) {
      try {
        await markWhatsAppSourceFailure(ctx, conversation.accountId, cause);
      } catch (markCause) {
        console.error('[brain-corpus] failed to expose source failure', markCause);
      }
      console.error('[brain-corpus] isolated dirty conversation failure', {
        accountId: conversation.accountId,
        chatId: conversation.chatId,
        cause,
      });
      const reason = cause instanceof Error ? cause.message : String(cause);
      failure = `${conversation.accountId}/${conversation.chatId}: ${reason}`;
    }
    const next = cursor.next + 1;
    const failures = failure ? [...cursor.failures, failure].slice(-20) : cursor.failures;
    return next >= cursor.conversations.length
      ? { done: true, error: failures.length > 0 ? failures.join('; ') : undefined }
      : { done: false, cursor: { ...cursor, next, failures } satisfies DirtyCursor };
  }

  try {
    const page = await backfillWhatsAppConversations(ctx, {
      cursor: cursor.cursor,
      limit: RECONCILE_BATCH,
    });
    const next: ReconcileCursor = {
      kind: 'reconcile',
      cursor: page.nextCursor,
      processed: cursor.processed + page.processed,
      changedChunks: cursor.changedChunks + page.changedChunks,
      embeddedChunks: cursor.embeddedChunks + page.embeddedChunks,
    };
    return page.hasMore ? { done: false, cursor: next } : { done: true };
  } catch (cause) {
    try {
      await markWhatsAppSourceFailure(ctx, null, cause);
    } catch (markCause) {
      console.error('[brain-corpus] failed to expose reconcile failure', markCause);
    }
    throw cause;
  }
}

registerJobHandler({ type: BRAIN_CORPUS_JOB_TYPE, advance: advanceBrainCorpusJob });

/** Optional on-demand kick after enqueue; the cron remains authoritative. */
export async function advanceBrainCorpusJobNow(jobId: string): Promise<void> {
  await advanceJob(jobId, 20_000);
}
