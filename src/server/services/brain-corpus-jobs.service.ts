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
}

interface DirtyCursor {
  kind: 'dirty';
  conversations: DirtyWhatsAppConversation[];
  next: number;
}

interface ReconcileCursor {
  kind: 'reconcile';
  cursor: string | null;
  processed: number;
  changedChunks: number;
  embeddedChunks: number;
}

type BrainCorpusCursor = DirtyCursor | ReconcileCursor;

export function collectDirtyWhatsAppConversations(
  rows: Pick<IngestRow, 'channel' | 'accountId' | 'chatId' | 'isGroup' | 'isBot' | 'content'>[],
): DirtyWhatsAppConversation[] {
  const unique = new Map<string, DirtyWhatsAppConversation>();
  for (const row of rows) {
    if (row.channel !== 'whatsapp') continue;
    if (row.isGroup === true || row.isBot === true) continue;
    if (!row.accountId?.trim() || !row.chatId?.trim() || !row.content?.trim()) continue;
    const value = { accountId: row.accountId.trim(), chatId: row.chatId.trim() };
    unique.set(`${value.accountId}\u0000${value.chatId}`, value);
  }
  return [...unique.values()].sort(
    (a, b) => a.accountId.localeCompare(b.accountId) || a.chatId.localeCompare(b.chatId),
  );
}

export async function enqueueWhatsAppBrainChanges(
  orgId: string,
  rows: Pick<IngestRow, 'channel' | 'accountId' | 'chatId' | 'isGroup' | 'isBot' | 'content'>[],
): Promise<string | null> {
  const conversations = collectDirtyWhatsAppConversations(rows);
  if (conversations.length === 0) return null;
  return enqueueJob({
    tenantId: orgId,
    type: BRAIN_CORPUS_JOB_TYPE,
    refId: DIRTY_REF,
    cursor: { kind: 'dirty', conversations, next: 0 } satisfies DirtyCursor,
  });
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
      conversations: value.conversations.filter(
        (item): item is DirtyWhatsAppConversation =>
          typeof item?.accountId === 'string' && typeof item?.chatId === 'string',
      ),
      next: Math.max(0, Number(value.next) || 0),
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
    if (!conversation) return { done: true };
    try {
      await syncWhatsAppConversation(ctx, conversation.accountId, conversation.chatId);
    } catch (cause) {
      try {
        await markWhatsAppSourceFailure(ctx, conversation.accountId, cause);
      } catch (markCause) {
        console.error('[brain-corpus] failed to expose source failure', markCause);
      }
      throw cause;
    }
    const next = cursor.next + 1;
    return next >= cursor.conversations.length
      ? { done: true }
      : { done: false, cursor: { ...cursor, next } satisfies DirtyCursor };
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
