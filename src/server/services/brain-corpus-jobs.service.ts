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
  type JobExecution,
} from './bg-runtime';
import {
  backfillConversations,
  classifyCorpusJobError,
  corpusJobFailure,
  markConversationSourceFailure,
  syncConversation,
  type ConversationPageProgress,
  type CorpusJobContext,
} from './brain-corpus.service';

export const BRAIN_CORPUS_JOB_TYPE = 'brain_corpus_conversations';
export const LEGACY_BRAIN_CORPUS_JOB_TYPE = 'brain_corpus_whatsapp';
const RECONCILE_REF = 'conversations:reconcile';
const DIRTY_REF = 'conversations:dirty';
const RECONCILE_BATCH = 25;
/** A page whose observed source changed is re-prepared this many times before
 * it counts as an ordinary failure; the changed conversation's own dirty job
 * covers the newer content. */
const SUPERSEDED_RETRIES = 2;

export interface DirtyConversation {
  channel: string;
  accountId: string;
  chatId: string;
  /** Empty means the event lacked a trustworthy timestamp; rescan all months. */
  months: string[];
}

interface DirtyCursor {
  kind: 'dirty';
  conversations: DirtyConversation[];
  next: number;
  /** Durable, bounded failure notes accumulated while later items continue. */
  failures: string[];
  /** Re-preparations of the current item after its source superseded the page. */
  attempts?: number;
}

interface ReconcileCursor {
  kind: 'reconcile';
  cursor: string | null;
  processed: number;
  changedChunks: number;
  embeddedChunks: number;
  attempts?: number;
}

type BrainCorpusCursor = DirtyCursor | ReconcileCursor;
type LegacyCompatibleDirtyConversation = Omit<DirtyConversation, 'channel'> & {
  channel?: string;
};
interface ParsedDirtyConversation {
  channel?: unknown;
  accountId?: unknown;
  chatId?: unknown;
  months?: unknown;
}

type DirtyIngestRow = Pick<
  IngestRow,
  'channel' | 'accountId' | 'chatId' | 'isGroup' | 'isBot' | 'content'
> & { occurredAt?: number | null };

export function collectDirtyConversations(rows: DirtyIngestRow[]): DirtyConversation[] {
  const unique = new Map<string, DirtyConversation>();
  for (const row of rows) {
    const channel = typeof row.channel === 'string' ? row.channel.trim().toLowerCase() : '';
    if (!channel) continue;
    if (row.isGroup === true || row.isBot === true) continue;
    if (!row.chatId?.trim() || !row.content?.trim()) continue;
    const accountId = row.accountId?.trim() || 'default';
    const chatId = row.chatId.trim();
    const key = `${channel}\u0000${accountId}\u0000${chatId}`;
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
    unique.set(key, { channel, accountId, chatId, months });
  }
  return [...unique.values()].sort(
    (a, b) =>
      a.channel.localeCompare(b.channel) ||
      a.accountId.localeCompare(b.accountId) ||
      a.chatId.localeCompare(b.chatId),
  );
}

export async function enqueueConversationBrainChanges(
  orgId: string,
  rows: DirtyIngestRow[],
): Promise<string | null> {
  const conversations = collectDirtyConversations(rows);
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
        const merged = mergeDirtyConversations([
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

export function mergeDirtyConversations(conversations: DirtyConversation[]): DirtyConversation[] {
  const merged = new Map<string, DirtyConversation>();
  for (const item of conversations) {
    const key = `${item.channel}\u0000${item.accountId}\u0000${item.chatId}`;
    const current = merged.get(key);
    const months = !current
      ? [...item.months]
      : current.months.length === 0 || item.months.length === 0
        ? []
        : [...new Set([...current.months, ...item.months])].sort();
    merged.set(key, {
      channel: item.channel,
      accountId: item.accountId,
      chatId: item.chatId,
      months,
    });
  }
  return [...merged.values()].sort(
    (a, b) =>
      a.channel.localeCompare(b.channel) ||
      a.accountId.localeCompare(b.accountId) ||
      a.chatId.localeCompare(b.chatId),
  );
}

export async function ensureConversationReconcileJob(
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
  const value = JSON.parse(job.cursor) as {
    kind?: unknown;
    conversations?: ParsedDirtyConversation[];
    next?: unknown;
    failures?: unknown;
    attempts?: unknown;
    cursor?: unknown;
    processed?: unknown;
    changedChunks?: unknown;
    embeddedChunks?: unknown;
  };
  if (value.kind === 'dirty' && Array.isArray(value.conversations)) {
    return {
      kind: 'dirty',
      conversations: value.conversations
        .filter(
          (item): item is LegacyCompatibleDirtyConversation =>
            (typeof item?.channel === 'string' || job.type === LEGACY_BRAIN_CORPUS_JOB_TYPE) &&
            typeof item?.accountId === 'string' &&
            typeof item?.chatId === 'string',
        )
        .map((item) => ({
          channel: item.channel ?? 'whatsapp',
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
      attempts: Math.max(0, Number(value.attempts) || 0),
    };
  }
  if (value.kind === 'reconcile') {
    return {
      kind: 'reconcile',
      cursor: typeof value.cursor === 'string' ? value.cursor : null,
      processed: Math.max(0, Number(value.processed) || 0),
      changedChunks: Math.max(0, Number(value.changedChunks) || 0),
      embeddedChunks: Math.max(0, Number(value.embeddedChunks) || 0),
      attempts: Math.max(0, Number(value.attempts) || 0),
    };
  }
  throw new Error('brain corpus job has an invalid cursor');
}

/** Ownership loss, indeterminate provider outcomes and reservation contention
 * are classified BEFORE ordinary per-conversation failure handling: they never
 * count as failures, never write source status and never advance progress. */
function nonOrdinary(cause: unknown, cursor: BrainCorpusCursor): AdvanceResult | null {
  const kind = classifyCorpusJobError(cause);
  if (kind === 'ordinary') return null;
  if (kind === 'fenced') throw corpusJobFailure(cause, 'brain_corpus');
  const attempts = cursor.attempts ?? 0;
  if (kind === 'superseded' && attempts >= SUPERSEDED_RETRIES) return null;
  return {
    done: false,
    cursor: { ...cursor, attempts: kind === 'superseded' ? attempts + 1 : attempts },
  };
}

export async function advanceBrainCorpusJob(
  job: BgJob,
  execution: JobExecution,
): Promise<AdvanceResult> {
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
    const next = cursor.next + 1;
    const advanced = (failures: string[]): DirtyCursor => ({
      ...cursor,
      next,
      failures,
      attempts: 0,
    });
    const result = (failures: string[]): AdvanceResult =>
      next >= cursor.conversations.length
        ? { done: true, error: failures.length > 0 ? failures.join('; ') : undefined }
        : { done: false, cursor: advanced(failures) };
    const owned: CorpusJobContext<ConversationPageProgress> = {
      execution,
      cursor: cursor as unknown as Record<string, unknown>,
      progress: () => advanced(cursor.failures) as unknown as Record<string, unknown>,
    };
    try {
      await syncConversation(
        ctx,
        conversation.channel,
        conversation.accountId,
        conversation.chatId,
        { months: conversation.months },
        owned,
      );
    } catch (cause) {
      const retry = nonOrdinary(cause, cursor);
      if (retry) return retry;
      const reason = cause instanceof Error ? cause.message : String(cause);
      const failure = `${conversation.channel}/${conversation.accountId}/${conversation.chatId}: ${reason}`;
      const failures = [...cursor.failures, failure].slice(-20);
      try {
        // Failure state and the exact next cursor commit together under ownership.
        await markConversationSourceFailure(
          ctx,
          conversation.channel,
          conversation.accountId,
          cause,
          { execution, nextProgress: advanced(failures) as unknown as Record<string, unknown> },
        );
      } catch (markCause) {
        if (classifyCorpusJobError(markCause) === 'fenced')
          throw corpusJobFailure(markCause, 'brain_corpus');
        console.error('[brain-corpus] failed to expose source failure', markCause);
      }
      console.error('[brain-corpus] isolated dirty conversation failure', {
        channel: conversation.channel,
        accountId: conversation.accountId,
        chatId: conversation.chatId,
        cause,
      });
      return result(failures);
    }
    return result(cursor.failures);
  }

  const progress = (page: ConversationPageProgress): ReconcileCursor => ({
    kind: 'reconcile',
    cursor: page.nextCursor,
    processed: cursor.processed + page.processed,
    changedChunks: cursor.changedChunks + page.changedChunks,
    embeddedChunks: cursor.embeddedChunks + page.embeddedChunks,
    attempts: 0,
  });
  try {
    const page = await backfillConversations(
      ctx,
      { cursor: cursor.cursor, limit: RECONCILE_BATCH },
      {
        execution,
        cursor: cursor as unknown as Record<string, unknown>,
        progress: (result) => progress(result) as unknown as Record<string, unknown>,
      },
    );
    return page.hasMore ? { done: false, cursor: progress(page) } : { done: true };
  } catch (cause) {
    const retry = nonOrdinary(cause, cursor);
    if (retry) return retry;
    try {
      await markConversationSourceFailure(ctx, null, null, cause, { execution });
    } catch (markCause) {
      if (classifyCorpusJobError(markCause) === 'fenced')
        throw corpusJobFailure(markCause, 'brain_corpus');
      console.error('[brain-corpus] failed to expose reconcile failure', markCause);
    }
    throw cause;
  }
}

registerJobHandler({ type: BRAIN_CORPUS_JOB_TYPE, advance: advanceBrainCorpusJob });
registerJobHandler({ type: LEGACY_BRAIN_CORPUS_JOB_TYPE, advance: advanceBrainCorpusJob });

/** Optional on-demand kick after enqueue; the cron remains authoritative. */
export async function advanceBrainCorpusJobNow(jobId: string): Promise<void> {
  await advanceJob(jobId, 20_000);
}

/** Compatibility aliases for routes/tests written before the all-channel corpus. */
export const collectDirtyWhatsAppConversations = collectDirtyConversations;
export const enqueueWhatsAppBrainChanges = enqueueConversationBrainChanges;
export const mergeDirtyWhatsAppConversations = mergeDirtyConversations;
export const ensureWhatsAppReconcileJob = ensureConversationReconcileJob;
