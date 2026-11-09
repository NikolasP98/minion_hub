import { resolveCapabilities } from './rbac.service';
import { currentEffectiveAuthority } from '$server/auth/effective-authority';
import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import { workflowDefs, type WorkflowDef } from '$server/db/pg-workflow-schema';
import { supportIssues } from '$server/db/pg-support-schema';
import { salesOrders } from '$server/db/pg-sales-schema';
import { recordAuditInTx } from './activity.service';
import type { CoreCtx } from '$server/auth/core-ctx';

/** Status-bearing docs a workflow can drive. Key set = security allowlist. */
const WF_META = {
  support_issue: { table: supportIssues, module: 'support' as const },
  sales_order: { table: salesOrders, module: 'sales' as const },
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
  adminBypass?: boolean;
}

/**
 * Pure: transitions available from `currentState` for `actor`. Gated by role
 * (admin bypasses) and the self-approval rule (owner can't take a transition
 * flagged allowSelfApprove:false). The one testable bit.
 */
export function availableTransitions(
  transitions: Transition[],
  currentState: string,
  actor: { role: string | null; id: string | null; adminBypass?: boolean },
  ownerId: string | null,
): Transition[] {
  const isAdmin = actor.adminBypass ?? actor.role === 'admin';
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
      .where(
        and(
          eq(workflowDefs.orgId, ctx.tenantId),
          eq(workflowDefs.docType, docType),
          eq(workflowDefs.enabled, true),
        ),
      ),
  );
  return row ?? null;
}

/** Document workflow admission uses the same capability and own-record rules as domain APIs. */
async function workflowAdmission(
  ctx: CoreCtx,
  docType: string,
  actor: Actor,
  action: 'view' | 'edit',
) {
  if (!isWfDocType(docType)) return null;
  const effective = actor.id ? currentEffectiveAuthority(ctx.tenantId, actor.id) : undefined;
  if (!effective && actor.role === 'admin') return { ownerId: null };
  if (!actor.id) return null;
  const caps = await resolveCapabilities(ctx.tenantId, actor.id);
  const module = WF_META[docType].module;
  if (!caps.can(module, action)) return null;
  return { ownerId: caps.ownerScoped(module) ? actor.id : null };
}

/** Transitions a given doc can currently take (empty if no enabled workflow). */
export async function transitionsFor(
  ctx: CoreCtx,
  docType: string,
  docId: string,
  actor: Actor,
): Promise<Transition[]> {
  const effective = actor.id ? currentEffectiveAuthority(ctx.tenantId, actor.id) : undefined;
  if (effective)
    actor = { ...actor, role: effective.invalid ? null : effective.roleKey, adminBypass: false };
  const admission = await workflowAdmission(ctx, docType, actor, 'view');
  if (!admission) return [];
  const def = await getDef(ctx, docType);
  if (!def) return [];
  const t = WF_META[docType as WfDocType].table;
  const [doc] = await withOrgCore(ctx, (tx) =>
    tx
      .select({ status: t.status, owner: t.ownerId })
      .from(t)
      .where(
        and(
          eq(t.id, docId),
          eq(t.orgId, ctx.tenantId),
          admission.ownerId ? eq(t.ownerId, admission.ownerId) : undefined,
        ),
      ),
  );
  if (!doc) return [];
  return availableTransitions(
    (def.transitions as Transition[]) ?? [],
    doc.status,
    actor,
    doc.owner ?? null,
  );
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
  const effective = actor.id ? currentEffectiveAuthority(ctx.tenantId, actor.id) : undefined;
  if (effective)
    actor = { ...actor, role: effective.invalid ? null : effective.roleKey, adminBypass: false };
  const admission = await workflowAdmission(ctx, docType, actor, 'edit');
  if (!admission) return 'forbidden';
  const def = await getDef(ctx, docType);
  if (!def) return 'no_workflow';
  const t = WF_META[docType as WfDocType].table;
  const [doc] = await withOrgCore(ctx, (tx) =>
    tx
      .select({ status: t.status, owner: t.ownerId })
      .from(t)
      .where(
        and(
          eq(t.id, docId),
          eq(t.orgId, ctx.tenantId),
          admission.ownerId ? eq(t.ownerId, admission.ownerId) : undefined,
        ),
      ),
  );
  if (!doc) return 'not_found';
  const allowed = availableTransitions(
    (def.transitions as Transition[]) ?? [],
    doc.status,
    actor,
    doc.owner ?? null,
  );
  const tr = allowed.find((x) => x.action === action);
  if (!tr) return 'forbidden';
  const changed = await withOrgCore(ctx, async (tx) => {
    const rows = await tx
      .update(t)
      .set({ status: tr.to })
      .where(
        and(
          eq(t.id, docId),
          eq(t.orgId, ctx.tenantId),
          eq(t.status, doc.status),
          admission.ownerId ? eq(t.ownerId, admission.ownerId) : undefined,
        ),
      )
      .returning({ id: t.id });
    if (!rows.length) return false;
    await recordAuditInTx(tx, ctx, {
      refType: docType,
      refId: docId,
      op: 'workflow',
      changes: [{ field: 'status', label: tr.action, old: doc.status, new: tr.to }],
      actor: { id: actor.id, name: actor.name },
    });
    return true;
  });
  if (!changed) return 'forbidden';
  return 'ok';
}

/**
 * Pure: may `actor` set status `current → next` directly (bypassing the action
 * buttons), given the workflow's transitions? A no-op (current===next) is always
 * fine; otherwise `next` must be a reachable `to` for this actor from `current`.
 */
export function isStatusChangeAllowed(
  transitions: Transition[],
  current: string,
  next: string,
  actor: { role: string | null; id: string | null; adminBypass?: boolean },
  ownerId: string | null,
): boolean {
  if (current === next) return true;
  return availableTransitions(transitions, current, actor, ownerId).some((x) => x.to === next);
}

/** The caller holds the document row lock; validate the state it will actually mutate. */
export async function assertStatusChangeInTx(
  tx: CoreTx,
  ctx: CoreCtx,
  docType: WfDocType,
  current: { status: string; ownerId: string | null },
  next: string,
  actor: Actor,
): Promise<void> {
  const effective = currentEffectiveAuthority(ctx.tenantId, ctx.profileId ?? actor.id ?? '');
  if (effective)
    actor = {
      ...actor,
      id: effective.profileId,
      role: effective.invalid ? null : effective.roleKey,
      adminBypass: false,
    };
  const [def] = await tx
    .select()
    .from(workflowDefs)
    .where(
      and(
        eq(workflowDefs.orgId, ctx.tenantId),
        eq(workflowDefs.docType, docType),
        eq(workflowDefs.enabled, true),
      ),
    )
    .for('share')
    .limit(1);
  if (
    def &&
    !isStatusChangeAllowed(
      (def.transitions as Transition[]) ?? [],
      current.status,
      next,
      actor,
      current.ownerId,
    )
  )
    throw error(409, 'status change not permitted by workflow');
}

/**
 * Guard for the direct status-PATCH endpoints. Returns true when the change must
 * be REJECTED. Inert (false) when no enabled workflow exists for the doc type —
 * so status edits work exactly as before until an admin defines a workflow, at
 * which point the engine becomes enforced instead of merely advisory.
 */
export async function statusChangeBlocked(
  ctx: CoreCtx,
  docType: string,
  docId: string,
  next: string,
  actor: Actor,
): Promise<boolean> {
  const effective = actor.id ? currentEffectiveAuthority(ctx.tenantId, actor.id) : undefined;
  if (effective)
    actor = { ...actor, role: effective.invalid ? null : effective.roleKey, adminBypass: false };
  const admission = await workflowAdmission(ctx, docType, actor, 'edit');
  if (!admission) return true;
  const t = WF_META[docType as WfDocType].table;
  const [doc] = await withOrgCore(ctx, (tx) =>
    tx
      .select({ status: t.status, owner: t.ownerId })
      .from(t)
      .where(
        and(
          eq(t.id, docId),
          eq(t.orgId, ctx.tenantId),
          admission.ownerId ? eq(t.ownerId, admission.ownerId) : undefined,
        ),
      ),
  );
  // A scoped miss is a denial even with no workflow; downstream PATCH services
  // must never interpret another person's record as an unrestricted no-op.
  if (!doc) return admission.ownerId !== null;
  const def = await getDef(ctx, docType);
  if (!def) return false;
  return !isStatusChangeAllowed(
    (def.transitions as Transition[]) ?? [],
    doc.status,
    next,
    actor,
    doc.owner ?? null,
  );
}

// ── Def CRUD (admin settings) ─────────────────────────────────────────────────
export function listDefs(ctx: CoreCtx): Promise<WorkflowDef[]> {
  return withOrgCore(ctx, (tx) =>
    tx.select().from(workflowDefs).where(eq(workflowDefs.orgId, ctx.tenantId)),
  );
}

export type NewDefInput = Omit<
  typeof workflowDefs.$inferInsert,
  'id' | 'orgId' | 'createdAt' | 'updatedAt'
>;

export async function upsertDef(ctx: CoreCtx, input: NewDefInput): Promise<WorkflowDef> {
  if (!isWfDocType(input.docType)) throw new Error('doc_type not allowed');
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .insert(workflowDefs)
      .values({ ...input, orgId: ctx.tenantId })
      .onConflictDoUpdate({
        target: [workflowDefs.orgId, workflowDefs.docType],
        set: {
          name: input.name,
          enabled: input.enabled ?? true,
          states: input.states,
          transitions: input.transitions,
          updatedAt: new Date(),
        },
      })
      .returning(),
  );
  return row;
}

export async function deleteDef(ctx: CoreCtx, id: string): Promise<void> {
  await withOrgCore(ctx, (tx) =>
    tx
      .delete(workflowDefs)
      .where(and(eq(workflowDefs.id, id), eq(workflowDefs.orgId, ctx.tenantId))),
  );
}
