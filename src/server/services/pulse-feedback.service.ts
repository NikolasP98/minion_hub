import { z } from 'zod';
import { and, eq, desc, sql, inArray, getTableColumns } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import type { CoreCtx } from '$server/auth/core-ctx';
import { getOrgTransactionDb } from '$server/db/pg-client';
import { withOrgCoreTransaction, type CoreTx } from '$server/db/with-org-core';
import { pulseFeedback as feedback } from '$server/db/pg-schema/pulse-feedback';
import { pulseProposals } from '$server/db/pg-schema/pulse';
import { pulseDigestRuns } from '$server/db/pg-schema/pulse-digest';
import { assertDigestOwnerTx } from './pulse-digest.authority';
import { pulseHash } from './pulse-action-contract';

export const feedbackReasons = [
  'useful',
  'irrelevant',
  'duplicate',
  'fact_error',
  'already_handled',
  'too_late',
] as const;
export const feedbackInputSchema = z
  .object({
    clientActionId: z.string().uuid(),
    expectedContentRevision: z.number().int().positive(),
    reason: z.enum(feedbackReasons),
    comment: z
      .string()
      .refine(
        (v) =>
          Array.from(v).length <= 500 &&
          Array.from(v).every((c) => {
            const n = c.codePointAt(0)!;
            return n < 0xd800 || n > 0xdfff;
          }),
        'comment_limit',
      )
      .optional(),
    supersedesFeedbackId: z.string().uuid().optional(),
  })
  .strict();
export type FeedbackInput = z.infer<typeof feedbackInputSchema>;
export async function readPulseFeedbackInput(request: Request): Promise<FeedbackInput> {
  const reader = request.body?.getReader();
  if (!reader) throw error(400, 'invalid_feedback');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 8192) throw error(413, 'feedback_body_limit');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  try {
    return feedbackInputSchema.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))),
    );
  } catch {
    throw error(400, 'invalid_feedback');
  }
}
function owner(ctx: CoreCtx) {
  if (!ctx.profileId) throw error(401, 'profile_required');
  return { tenantId: ctx.tenantId, profileId: ctx.profileId };
}
async function feedbackCard(tx: CoreTx, ctx: CoreCtx, id: string) {
  const scope = owner(ctx);
  const [card] = await tx
    .select()
    .from(pulseProposals)
    .where(
      and(
        eq(pulseProposals.id, id),
        eq(pulseProposals.orgId, scope.tenantId),
        eq(pulseProposals.ownerProfileId, scope.profileId),
      ),
    )
    .for('update');
  if (!card?.internalRunId) throw error(404, 'not_found');
  const [run] = await tx
    .select()
    .from(pulseDigestRuns)
    .where(
      and(
        eq(pulseDigestRuns.id, card.internalRunId),
        eq(pulseDigestRuns.orgId, scope.tenantId),
        eq(pulseDigestRuns.ownerProfileId, scope.profileId),
        eq(pulseDigestRuns.state, 'published'),
      ),
    );
  if (
    !run ||
    run.cardId !== card.id ||
    card.internalInputHash !== run.sourceSnapshotHash ||
    card.internalResultHash !== run.resultHash ||
    card.internalPolicyRevision !== run.policyRevision
  )
    throw error(404, 'not_found');
  return { card, run };
}
export async function savePulseFeedback(ctx: CoreCtx, id: string, input: FeedbackInput) {
  input = feedbackInputSchema.parse(input);
  const scope = owner(ctx);
  const payloadHash = pulseHash({ id, ...input });
  return getOrgTransactionDb(ctx.db).transaction(async (tx) => {
    await assertDigestOwnerTx(tx, scope, 'edit');
    return withOrgCoreTransaction(scope, tx, async (domain) => {
      const { card, run } = await feedbackCard(domain, ctx, id);
      if (card.revision !== input.expectedContentRevision) throw error(409, 'refresh_required');
      const [existing] = await domain
        .select()
        .from(feedback)
        .where(
          and(
            eq(feedback.orgId, scope.tenantId),
            eq(feedback.actorProfileId, scope.profileId),
            eq(feedback.clientActionId, input.clientActionId),
          ),
        );
      if (existing) {
        if (existing.payloadHash !== payloadHash) throw error(409, 'feedback_action_conflict');
        return existing;
      }
      const contentHash = run.resultHash!;
      if (input.supersedesFeedbackId) {
        const [prior] = await domain
          .select()
          .from(feedback)
          .where(
            and(
              eq(feedback.id, input.supersedesFeedbackId),
              eq(feedback.orgId, scope.tenantId),
              eq(feedback.ownerProfileId, scope.profileId),
              eq(feedback.proposalId, id),
              eq(feedback.contentRevision, card.revision),
              eq(feedback.contentHash, contentHash),
            ),
          )
          .for('update');
        if (!prior) throw error(409, 'feedback_predecessor_conflict');
        const [successor] = await domain
          .select({ id: feedback.id })
          .from(feedback)
          .where(eq(feedback.supersedesFeedbackId, prior.id));
        if (successor) throw error(409, 'feedback_already_corrected');
      }
      const [saved] = await domain
        .insert(feedback)
        .values({
          orgId: scope.tenantId,
          ownerProfileId: scope.profileId,
          actorProfileId: scope.profileId,
          proposalId: id,
          contentRevision: card.revision,
          digestRunId: run.id,
          policyRevision: run.policyRevision,
          sourceSnapshotHash: run.sourceSnapshotHash,
          sourceRevisions: run.sourceRevisions,
          contentHash,
          reason: input.reason,
          comment: input.comment ?? null,
          clientActionId: input.clientActionId,
          supersedesFeedbackId: input.supersedesFeedbackId ?? null,
          payloadHash,
        })
        .returning();
      return saved;
    });
  });
}
export async function getPulseFeedback(ctx: CoreCtx, id: string) {
  const scope = owner(ctx);
  return getOrgTransactionDb(ctx.db).transaction(async (tx) => {
    await assertDigestOwnerTx(tx, scope, 'view');
    return withOrgCoreTransaction(scope, tx, async (domain) => {
      await feedbackCard(domain, ctx, id);
      return domain
        .select()
        .from(feedback)
        .where(
          and(
            eq(feedback.orgId, scope.tenantId),
            eq(feedback.ownerProfileId, scope.profileId),
            eq(feedback.proposalId, id),
          ),
        )
        .orderBy(desc(feedback.createdAt), desc(feedback.id))
        .limit(100);
    });
  });
}
const cursorSchema = z.object({ at: z.string().datetime(), id: z.string().uuid() }).strict();
export async function exportPulseFeedback(ctx: CoreCtx, params: URLSearchParams): Promise<string> {
  const scope = owner(ctx);
  if (
    [...params.keys()].some((k) => !['limit', 'after'].includes(k)) ||
    params.getAll('limit').length > 1 ||
    params.getAll('after').length > 1
  )
    throw error(400, 'invalid_pagination');
  const limit = z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .safeParse(params.get('limit') ?? 100);
  if (!limit.success) throw error(400, 'invalid_pagination');
  let cursor: z.infer<typeof cursorSchema> | null = null;
  try {
    const raw = params.get('after');
    if (raw) {
      if (raw.length > 256) throw new Error();
      cursor = cursorSchema.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
    }
  } catch {
    throw error(400, 'invalid_pagination');
  }
  return getOrgTransactionDb(ctx.db).transaction(async (tx) => {
    await assertDigestOwnerTx(tx, scope, 'export');
    return withOrgCoreTransaction(scope, tx, async (domain) => {
      const rows = await domain
        .select({
          ...getTableColumns(feedback),
          cursorAt: sql<string>`to_char(${feedback.createdAt} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        })
        .from(feedback)
        .where(
          and(
            eq(feedback.orgId, scope.tenantId),
            eq(feedback.ownerProfileId, scope.profileId),
            ...(cursor
              ? [
                  sql`(${feedback.createdAt},${feedback.id})<(${cursor.at}::timestamptz,${cursor.id}::uuid)`,
                ]
              : []),
          ),
        )
        .orderBy(desc(feedback.createdAt), desc(feedback.id))
        .limit(limit.data + 1);
      const lines = [JSON.stringify({ schema: 'pulse-feedback-v1', automaticLearning: false })];
      let bytes = Buffer.byteLength(lines[0]) + 1;
      let count = 0;
      for (const row of rows.slice(0, limit.data)) {
        const line = JSON.stringify({
          group: row.reason === 'fact_error' ? 'factual_errors' : 'preference_relevance',
          feedback: row,
        });
        // Reserve the bounded final pagination line. Unexported records remain in the next page.
        if (bytes + Buffer.byteLength(line) + 1024 > 262144) break;
        lines.push(line);
        bytes += Buffer.byteLength(line) + 1;
        count++;
      }
      const last = rows[count - 1];
      const nextCursor =
        rows.length > count && last
          ? Buffer.from(JSON.stringify({ at: last.cursorAt, id: last.id })).toString('base64url')
          : null;
      lines.push(JSON.stringify({ nextCursor }));
      return lines.join('\n') + '\n';
    });
  });
}
export async function redactPulseFeedbackTx(
  tx: CoreTx,
  scope: { tenantId: string; profileId: string },
): Promise<number> {
  const rows = await tx
    .select({ id: feedback.id })
    .from(feedback)
    .where(
      and(
        eq(feedback.orgId, scope.tenantId),
        eq(feedback.ownerProfileId, scope.profileId),
        sql`${feedback.createdAt}<now()-interval '30 days'`,
        sql`${feedback.redactedAt} is null`,
      ),
    )
    .orderBy(feedback.id)
    .limit(20)
    .for('update');
  if (!rows.length) return 0;
  await tx
    .update(feedback)
    .set({ comment: null, redactedAt: new Date() })
    .where(
      inArray(
        feedback.id,
        rows.map((r) => r.id),
      ),
    );
  return rows.length;
}
