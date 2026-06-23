import { and, eq, desc, sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import { docComments, docAuditLog } from '$server/db/pg-activity-schema';
import type { CoreCtx } from '$server/auth/core-ctx';

/**
 * Allowlist of commentable/auditable record types → their physical table.
 * The polymorphic (ref_type, ref_id) write path is otherwise an IDOR vector:
 * gate every ref_type here and confirm the row exists in this org before any
 * write (the table name comes from this constant, NOT user input, so the raw
 * SQL is safe). Add a new type = one line.
 */
const REF_TABLES: Record<string, string> = {
  support_issue: 'support_issues',
  sales_order: 'sales_orders',
  crm_contact: 'crm_contacts',
  proj_project: 'proj_projects',
  proj_task: 'proj_tasks',
};

/** True if refType is allowlisted AND the row exists in the caller's org. */
export async function refExists(ctx: CoreCtx, refType: string, refId: string): Promise<boolean> {
  const table = REF_TABLES[refType];
  if (!table) return false;
  return withOrgCore(ctx, async (tx) => {
    const rows = (await tx.execute(
      sql`select 1 from ${sql.raw(table)} where id = ${refId} and org_id = ${ctx.tenantId} limit 1`,
    )) as unknown as unknown[];
    return rows.length > 0;
  });
}

export interface FieldChange {
  field: string;
  label: string;
  old: unknown;
  new: unknown;
}

/** Pure: diff two snapshots over the given tracked fields. The one testable bit. */
export function computeChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: { field: string; label: string }[],
): FieldChange[] {
  const out: FieldChange[] = [];
  for (const f of fields) {
    if (before[f.field] !== after[f.field]) {
      out.push({ field: f.field, label: f.label, old: before[f.field] ?? null, new: after[f.field] ?? null });
    }
  }
  return out;
}

/** A merged, chronological timeline item (comment or audit) for the client. */
export interface TimelineItem {
  id: string;
  ts: string;
  src: 'comment' | 'audit';
  kind: string; // comment kind, or audit op
  body: string | null;
  actorName: string | null;
  changes: FieldChange[] | null;
}

export async function addComment(
  ctx: CoreCtx,
  refType: string,
  refId: string,
  body: string,
  actor: { id: string | null; name: string | null },
): Promise<void> {
  await withOrgCore(ctx, (tx) =>
    tx.insert(docComments).values({
      orgId: ctx.tenantId,
      refType,
      refId,
      kind: 'comment',
      body,
      actorId: actor.id,
      actorName: actor.name,
    }),
  );
}

/** Append an audit entry. No-op when there are no changes. Run inside the
 *  caller's tx when available; standalone otherwise. */
export async function recordAudit(
  ctx: CoreCtx,
  input: {
    refType: string;
    refId: string;
    op?: string;
    changes: FieldChange[];
    actor: { id: string | null; name: string | null };
  },
): Promise<void> {
  if (input.changes.length === 0) return;
  await withOrgCore(ctx, (tx) =>
    tx.insert(docAuditLog).values({
      orgId: ctx.tenantId,
      refType: input.refType,
      refId: input.refId,
      op: input.op ?? 'update',
      changes: input.changes,
      actorId: input.actor.id,
      actorName: input.actor.name,
    }),
  );
}

/** Merged comment + audit feed for one record, newest first. */
export async function listEntityTimeline(
  ctx: CoreCtx,
  refType: string,
  refId: string,
): Promise<TimelineItem[]> {
  return withOrgCore(ctx, async (tx) => {
    const [comments, audits] = await Promise.all([
      tx
        .select()
        .from(docComments)
        .where(and(eq(docComments.orgId, ctx.tenantId), eq(docComments.refType, refType), eq(docComments.refId, refId)))
        .orderBy(desc(docComments.createdAt))
        .limit(200),
      tx
        .select()
        .from(docAuditLog)
        .where(and(eq(docAuditLog.orgId, ctx.tenantId), eq(docAuditLog.refType, refType), eq(docAuditLog.refId, refId)))
        .orderBy(desc(docAuditLog.occurredAt))
        .limit(200),
    ]);
    const items: TimelineItem[] = [
      ...comments.map((c) => ({
        id: c.id,
        ts: c.createdAt.toISOString(),
        src: 'comment' as const,
        kind: c.kind,
        body: c.body,
        actorName: c.actorName,
        changes: null,
      })),
      ...audits.map((a) => ({
        id: a.id,
        ts: a.occurredAt.toISOString(),
        src: 'audit' as const,
        kind: a.op,
        body: null,
        actorName: a.actorName,
        changes: a.changes as FieldChange[],
      })),
    ];
    items.sort((x, y) => (x.ts < y.ts ? 1 : x.ts > y.ts ? -1 : 0));
    return items;
  });
}
