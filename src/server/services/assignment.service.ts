import { and, eq, inArray, sql } from 'drizzle-orm';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import { getCoreDb } from '$server/db/pg-client';
import { assignmentRules, type AssignmentRule } from '$server/db/pg-assignment-schema';
import { supportIssues } from '$server/db/pg-support-schema';
import { crmContacts } from '$server/db/pg-crm-schema';
import { salesOrders } from '$server/db/pg-sales-schema';
import { evaluateCondition, type Filter } from './notif.service';
import { recordAudit } from './activity.service';
import { listUsers } from './user.service';
import type { CoreCtx } from '$server/auth/core-ctx';

/**
 * Doc types an assignment rule (and the work queue) can target. The owner column
 * IS the assignment — no separate work_items table. `openStatuses` defines what
 * counts as "still on someone's plate" for the least-open strategy + the queue
 * (crm_contacts has no status → every owned contact is open). The key set is the
 * security allowlist: a rule's doc_type must be one of these.
 */
type Meta = {
  table: typeof supportIssues | typeof crmContacts | typeof salesOrders;
  titleCol: 'subject' | 'displayName' | 'customerName';
  href: string;
  openStatuses: string[] | null; // null = no status column (all owned rows are open)
};
const DOC_META: Record<string, Meta> = {
  support_issue: { table: supportIssues, titleCol: 'subject', href: '/support', openStatuses: ['open', 'replied', 'on_hold'] },
  crm_contact: { table: crmContacts, titleCol: 'displayName', href: '/crm', openStatuses: null },
  sales_order: { table: salesOrders, titleCol: 'customerName', href: '/sales', openStatuses: ['draft', 'confirmed'] },
};

export function isDocTypeAllowed(t: string): boolean {
  return Object.prototype.hasOwnProperty.call(DOC_META, t);
}
export const DOC_TYPES = Object.keys(DOC_META);

// ── Pure picker (the only non-trivial logic — tested) ─────────────────────────
export interface PickResult {
  assigneeId: string | null;
  nextCursor: number;
}
/**
 * Choose an assignee. round_robin walks `assignees` by `cursor`; least_open picks
 * the one with the fewest currently-open docs (ties → earliest in the list).
 */
export function pickAssignee(
  strategy: string,
  assignees: string[],
  cursor: number,
  openCounts: Record<string, number>,
): PickResult {
  if (!assignees.length) return { assigneeId: null, nextCursor: cursor };
  if (strategy === 'least_open') {
    let best = assignees[0];
    for (const a of assignees) if ((openCounts[a] ?? 0) < (openCounts[best] ?? 0)) best = a;
    return { assigneeId: best, nextCursor: cursor };
  }
  // round_robin (default)
  const idx = ((cursor % assignees.length) + assignees.length) % assignees.length;
  return { assigneeId: assignees[idx], nextCursor: cursor + 1 };
}

/** Open-doc counts per owner for a doc type (least_open input). */
async function openCounts(tx: CoreTx, docType: string, owners: string[]): Promise<Record<string, number>> {
  if (!owners.length) return {};
  const meta = DOC_META[docType];
  const t = meta.table;
  const conds = [eq(t.orgId, sql`current_setting('app.current_org_id', true)`), inArray(t.ownerId, owners)];
  if (meta.openStatuses) conds.push(inArray((t as typeof supportIssues).status, meta.openStatuses));
  const rows = await tx
    .select({ owner: t.ownerId, n: sql<number>`count(*)::int` })
    .from(t)
    .where(and(...conds))
    .groupBy(t.ownerId);
  const out: Record<string, number> = {};
  for (const r of rows) if (r.owner) out[r.owner] = r.n;
  return out;
}

/**
 * Auto-assign one freshly-created doc. Finds the first enabled rule for its
 * doc_type whose condition matches, picks an assignee, stamps owner_id (only if
 * still unassigned — never overrides a manual owner), advances the round-robin
 * cursor, and logs an audit entry. Returns the assignee id (or null = no-op).
 */
export async function autoAssign(
  ctx: CoreCtx,
  docType: string,
  doc: { id: string } & Record<string, unknown>,
): Promise<string | null> {
  if (!isDocTypeAllowed(docType)) return null;
  return withOrgCore(ctx, async (tx) => {
    const rules = await tx
      .select()
      .from(assignmentRules)
      .where(and(eq(assignmentRules.orgId, ctx.tenantId), eq(assignmentRules.docType, docType), eq(assignmentRules.enabled, true)))
      .orderBy(assignmentRules.createdAt);
    const rule = rules.find((r) => evaluateCondition((r.condition as Filter[]) ?? [], doc));
    if (!rule) return null;
    const assignees = (rule.assignees as string[]) ?? [];
    const counts = rule.strategy === 'least_open' ? await openCounts(tx, docType, assignees) : {};
    const { assigneeId, nextCursor } = pickAssignee(rule.strategy, assignees, rule.cursor, counts);
    if (!assigneeId) return null;

    const t = DOC_META[docType].table;
    // Only claim an unowned doc — respect a manually-set owner.
    const [claimed] = await tx
      .update(t)
      .set({ ownerId: assigneeId })
      .where(and(eq(t.id, doc.id), eq(t.orgId, ctx.tenantId), sql`${t.ownerId} is null`))
      .returning({ id: t.id });
    if (!claimed) return null;

    await tx.update(assignmentRules).set({ cursor: nextCursor, updatedAt: new Date() }).where(eq(assignmentRules.id, rule.id));
    return assigneeId;
  }).then(async (assigneeId) => {
    if (assigneeId)
      await recordAudit(ctx, {
        refType: docType,
        refId: doc.id,
        op: 'assign',
        changes: [{ field: 'owner_id', label: 'Owner', old: null, new: assigneeId }],
        actor: { id: null, name: 'assignment rule' },
      });
    return assigneeId;
  });
}

/** Manual reassign (or unassign with newOwner=null). Audited. */
export async function reassign(
  ctx: CoreCtx,
  docType: string,
  docId: string,
  newOwner: string | null,
  actor: { id: string | null; name: string | null; isAdmin: boolean },
): Promise<'ok' | 'not_found' | 'forbidden'> {
  if (!isDocTypeAllowed(docType)) return 'not_found';
  // newOwner (when set) must be a real member of the caller's org.
  if (newOwner) {
    const members = await listUsers({ tenantId: ctx.tenantId }).catch(() => []);
    if (!members.some((m) => m.id === newOwner)) return 'forbidden';
  }
  const t = DOC_META[docType].table;
  const [prev] = await withOrgCore(ctx, (tx) =>
    tx.select({ owner: t.ownerId }).from(t).where(and(eq(t.id, docId), eq(t.orgId, ctx.tenantId))),
  );
  if (!prev) return 'not_found';
  // Only an admin or the current owner may reassign — a non-owner can't grab or
  // dump another user's work.
  if (!actor.isAdmin && prev.owner !== actor.id) return 'forbidden';
  await withOrgCore(ctx, (tx) =>
    tx.update(t).set({ ownerId: newOwner }).where(and(eq(t.id, docId), eq(t.orgId, ctx.tenantId))),
  );
  await recordAudit(ctx, {
    refType: docType,
    refId: docId,
    op: 'reassign',
    changes: [{ field: 'owner_id', label: 'Owner', old: prev.owner ?? null, new: newOwner }],
    actor: { id: actor.id, name: actor.name },
  });
  return 'ok';
}

// ── Work queue (union read over owner_id columns) ─────────────────────────────
export interface WorkItem {
  docType: string;
  id: string;
  humanId: string | null;
  title: string;
  status: string | null;
  href: string;
  createdAt: string;
}

function toItem(
  docType: string,
  href: string,
  r: { id: string; humanId: string | null; title: string | null; status: string | null; createdAt: Date },
): WorkItem {
  return {
    docType,
    id: r.id,
    humanId: r.humanId,
    title: r.title ?? r.humanId ?? r.id,
    status: r.status,
    href: `${href}/${r.id}`,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Open docs owned by `userId` across all assignable doc types, newest first.
 *  Per-table selects (columns differ) — kept explicit rather than reflecting. */
export async function listMyWork(ctx: CoreCtx, userId: string): Promise<WorkItem[]> {
  return withOrgCore(ctx, async (tx) => {
    const [tickets, leads, orders] = await Promise.all([
      tx
        .select({ id: supportIssues.id, humanId: supportIssues.humanId, title: supportIssues.subject, status: supportIssues.status, createdAt: supportIssues.createdAt })
        .from(supportIssues)
        .where(and(eq(supportIssues.orgId, ctx.tenantId), eq(supportIssues.ownerId, userId), inArray(supportIssues.status, DOC_META.support_issue.openStatuses!)))
        .limit(200),
      tx
        .select({ id: crmContacts.id, humanId: crmContacts.humanId, title: crmContacts.displayName, status: sql<string | null>`null`, createdAt: crmContacts.createdAt })
        .from(crmContacts)
        .where(and(eq(crmContacts.orgId, ctx.tenantId), eq(crmContacts.ownerId, userId)))
        .limit(200),
      tx
        .select({ id: salesOrders.id, humanId: salesOrders.humanId, title: salesOrders.customerName, status: salesOrders.status, createdAt: salesOrders.createdAt })
        .from(salesOrders)
        .where(and(eq(salesOrders.orgId, ctx.tenantId), eq(salesOrders.ownerId, userId), inArray(salesOrders.status, DOC_META.sales_order.openStatuses!)))
        .limit(200),
    ]);
    const out = [
      ...tickets.map((r) => toItem('support_issue', DOC_META.support_issue.href, r)),
      ...leads.map((r) => toItem('crm_contact', DOC_META.crm_contact.href, r)),
      ...orders.map((r) => toItem('sales_order', DOC_META.sales_order.href, r)),
    ];
    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return out;
  });
}

// ── Rule CRUD (settings) ──────────────────────────────────────────────────────
export function listRules(ctx: CoreCtx): Promise<AssignmentRule[]> {
  return withOrgCore(ctx, (tx) =>
    tx.select().from(assignmentRules).where(eq(assignmentRules.orgId, ctx.tenantId)).orderBy(assignmentRules.createdAt),
  );
}

export type NewRuleInput = Omit<
  typeof assignmentRules.$inferInsert,
  'id' | 'orgId' | 'cursor' | 'createdAt' | 'updatedAt'
>;

export async function createRule(ctx: CoreCtx, input: NewRuleInput): Promise<AssignmentRule> {
  if (!isDocTypeAllowed(input.docType)) throw new Error('doc_type not allowed');
  const [row] = await withOrgCore(ctx, (tx) =>
    tx.insert(assignmentRules).values({ ...input, orgId: ctx.tenantId }).returning(),
  );
  return row;
}

export async function updateRule(ctx: CoreCtx, id: string, patch: Partial<NewRuleInput>): Promise<AssignmentRule | null> {
  if (patch.docType && !isDocTypeAllowed(patch.docType)) throw new Error('doc_type not allowed');
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .update(assignmentRules)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(assignmentRules.id, id), eq(assignmentRules.orgId, ctx.tenantId)))
      .returning(),
  );
  return row ?? null;
}

export async function deleteRule(ctx: CoreCtx, id: string): Promise<void> {
  await withOrgCore(ctx, (tx) =>
    tx.delete(assignmentRules).where(and(eq(assignmentRules.id, id), eq(assignmentRules.orgId, ctx.tenantId))),
  );
}

/** Orgs with at least one enabled rule (bypass-RLS, for any future cron use). */
export async function listEnabledAssignmentOrgs(): Promise<string[]> {
  const rows = await getCoreDb().selectDistinct({ orgId: assignmentRules.orgId }).from(assignmentRules).where(eq(assignmentRules.enabled, true));
  return rows.map((r) => r.orgId);
}
