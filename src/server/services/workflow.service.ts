import { and, eq } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import { workflowDefs, type WorkflowDef } from '$server/db/pg-workflow-schema';
import { supportIssues } from '$server/db/pg-support-schema';
import { salesOrders } from '$server/db/pg-sales-schema';
import { recordAudit } from './activity.service';
import type { CoreCtx } from '$server/auth/core-ctx';

/** Status-bearing docs a workflow can drive. Key set = security allowlist. */
const WF_META = {
  support_issue: { table: supportIssues },
  sales_order: { table: salesOrders },
} as const;
export type WfDocType = keyof typeof WF_META;
export function isWfDocType(t: string): t is WfDocType {
  return Object.prototype.hasOwnProperty.call(WF_META, t);
}
export const WF_DOC_TYPES = Object.keys(WF_META);

export interface Transition {
  action: string;
  from: string;
  to: string;
  /** Required role to take this transition; null/undefined = anyone. */
  role?: string | null;
  /** ERPNext "Allow Self Approval": false ⇒ the doc's owner can't take it. */
  allowSelfApprove?: boolean;
}

export interface Actor {
  id: string | null;
  name: string | null;
  role: string | null;
}

/**
 * Pure: transitions available from `currentState` for `actor`. Gated by role
 * (admin bypasses) and the self-approval rule (owner can't take a transition
 * flagged allowSelfApprove:false). The one testable bit.
 */
export function availableTransitions(
  transitions: Transition[],
  currentState: string,
  actor: { role: string | null; id: string | null },
  ownerId: string | null,
): Transition[] {
  const isAdmin = actor.role === 'admin';
  return transitions.filter((t) => {
    if (t.from !== currentState) return false;
    if (t.role && !isAdmin && t.role !== actor.role) return false;
    if (t.allowSelfApprove === false && ownerId && ownerId === actor.id && !isAdmin) return false;
    return true;
  });
}

export async function getDef(ctx: CoreCtx, docType: string): Promise<WorkflowDef | null> {
  if (!isWfDocType(docType)) return null;
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(workflowDefs)
      .where(and(eq(workflowDefs.orgId, ctx.tenantId), eq(workflowDefs.docType, docType), eq(workflowDefs.enabled, true))),
  );
  return row ?? null;
}

/** Transitions a given doc can currently take (empty if no enabled workflow). */
export async function transitionsFor(ctx: CoreCtx, docType: string, docId: string, actor: Actor): Promise<Transition[]> {
  const def = await getDef(ctx, docType);
  if (!def) return [];
  const t = WF_META[docType as WfDocType].table;
  const [doc] = await withOrgCore(ctx, (tx) =>
    tx.select({ status: t.status, owner: t.ownerId }).from(t).where(and(eq(t.id, docId), eq(t.orgId, ctx.tenantId))),
  );
  if (!doc) return [];
  return availableTransitions((def.transitions as Transition[]) ?? [], doc.status, actor, doc.owner ?? null);
}

export type ApplyResult = 'ok' | 'not_found' | 'forbidden' | 'no_workflow';

/** Take a workflow action on a doc: validate it's allowed from the current
 *  state for this actor, set the new status, log to doc_audit_log. */
export async function applyTransition(
  ctx: CoreCtx,
  docType: string,
  docId: string,
  action: string,
  actor: Actor,
): Promise<ApplyResult> {
  const def = await getDef(ctx, docType);
  if (!def) return 'no_workflow';
  const t = WF_META[docType as WfDocType].table;
  const [doc] = await withOrgCore(ctx, (tx) =>
    tx.select({ status: t.status, owner: t.ownerId }).from(t).where(and(eq(t.id, docId), eq(t.orgId, ctx.tenantId))),
  );
  if (!doc) return 'not_found';
  const allowed = availableTransitions((def.transitions as Transition[]) ?? [], doc.status, actor, doc.owner ?? null);
  const tr = allowed.find((x) => x.action === action);
  if (!tr) return 'forbidden';
  await withOrgCore(ctx, (tx) =>
    tx.update(t).set({ status: tr.to }).where(and(eq(t.id, docId), eq(t.orgId, ctx.tenantId))),
  );
  await recordAudit(ctx, {
    refType: docType,
    refId: docId,
    op: 'workflow',
    changes: [{ field: 'status', label: tr.action, old: doc.status, new: tr.to }],
    actor: { id: actor.id, name: actor.name },
  });
  return 'ok';
}

// ── Def CRUD (admin settings) ─────────────────────────────────────────────────
export function listDefs(ctx: CoreCtx): Promise<WorkflowDef[]> {
  return withOrgCore(ctx, (tx) => tx.select().from(workflowDefs).where(eq(workflowDefs.orgId, ctx.tenantId)));
}

export type NewDefInput = Omit<typeof workflowDefs.$inferInsert, 'id' | 'orgId' | 'createdAt' | 'updatedAt'>;

export async function upsertDef(ctx: CoreCtx, input: NewDefInput): Promise<WorkflowDef> {
  if (!isWfDocType(input.docType)) throw new Error('doc_type not allowed');
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .insert(workflowDefs)
      .values({ ...input, orgId: ctx.tenantId })
      .onConflictDoUpdate({
        target: [workflowDefs.orgId, workflowDefs.docType],
        set: { name: input.name, enabled: input.enabled ?? true, states: input.states, transitions: input.transitions, updatedAt: new Date() },
      })
      .returning(),
  );
  return row;
}

export async function deleteDef(ctx: CoreCtx, id: string): Promise<void> {
  await withOrgCore(ctx, (tx) =>
    tx.delete(workflowDefs).where(and(eq(workflowDefs.id, id), eq(workflowDefs.orgId, ctx.tenantId))),
  );
}
