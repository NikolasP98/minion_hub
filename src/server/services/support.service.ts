import { and, desc, eq, sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import {
  supportIssues,
  supportSettings,
  type SupportIssue,
  type NewSupportIssue,
} from '$server/db/pg-support-schema';
import { nextSerialId } from './naming-series';
import type { CoreCtx } from '$server/auth/core-ctx';

export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export type IssueStatus = 'open' | 'replied' | 'on_hold' | 'resolved' | 'closed';
export const PRIORITIES: Priority[] = ['urgent', 'high', 'medium', 'low'];

export interface SlaTier {
  responseMins: number;
  resolutionMins: number;
}
export interface SlaConfig {
  priorities: Record<Priority, SlaTier>;
}

/** Built-in default SLA (minutes). Used when an org has no support_settings row.
 *  ponytail: now()+minutes; no business-calendar (ERPNext's working-hours model
 *  is the upgrade path). */
export const DEFAULT_SLA: SlaConfig = {
  priorities: {
    urgent: { responseMins: 30, resolutionMins: 240 },
    high: { responseMins: 60, resolutionMins: 480 },
    medium: { responseMins: 240, resolutionMins: 1440 },
    low: { responseMins: 480, resolutionMins: 2880 },
  },
};

/** Pure: SLA deadlines for a priority from a base instant. The one bit of logic
 *  worth a test. */
export function computeSlaDeadlines(
  sla: SlaConfig,
  priority: Priority,
  from: Date,
): { responseBy: Date; resolutionBy: Date } {
  const tier = sla.priorities[priority] ?? DEFAULT_SLA.priorities[priority];
  return {
    responseBy: new Date(from.getTime() + tier.responseMins * 60_000),
    resolutionBy: new Date(from.getTime() + tier.resolutionMins * 60_000),
  };
}

/** Pure: derive the live SLA agreement status for an issue. Computed on read
 *  (never stored), mirroring how CRM derives RFM scores. */
export function agreementStatus(
  issue: Pick<
    SupportIssue,
    'status' | 'responseBy' | 'resolutionBy' | 'firstRespondedAt' | 'resolvedAt'
  >,
  now: Date,
): { state: 'fulfilled' | 'failed' | 'ongoing'; breached: boolean; dueBy: string | null } {
  if (issue.resolvedAt || issue.status === 'resolved' || issue.status === 'closed') {
    const failed = !!(
      issue.resolvedAt &&
      issue.resolutionBy &&
      new Date(issue.resolvedAt) > new Date(issue.resolutionBy)
    );
    return { state: failed ? 'failed' : 'fulfilled', breached: failed, dueBy: null };
  }
  // Still open: the live deadline is the response one until first reply, then resolution.
  const awaitingResponse = !issue.firstRespondedAt;
  const due = awaitingResponse ? issue.responseBy : issue.resolutionBy;
  const breached = !!(due && now > new Date(due));
  return {
    state: breached ? 'failed' : 'ongoing',
    breached,
    dueBy: due ? new Date(due).toISOString() : null,
  };
}

export async function getSlaConfig(ctx: CoreCtx): Promise<SlaConfig> {
  const [row] = await withOrgCore(ctx, (tx) =>
    tx.select().from(supportSettings).where(eq(supportSettings.orgId, ctx.tenantId)).limit(1),
  );
  const v = (row?.value ?? {}) as Partial<SlaConfig>;
  return { priorities: { ...DEFAULT_SLA.priorities, ...(v.priorities ?? {}) } };
}

export async function setSlaConfig(ctx: CoreCtx, config: SlaConfig): Promise<void> {
  await withOrgCore(ctx, (tx) =>
    tx
      .insert(supportSettings)
      .values({ orgId: ctx.tenantId, value: config, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: supportSettings.orgId,
        set: { value: config, updatedAt: new Date() },
      }),
  );
}

export interface IssueFilters {
  status?: IssueStatus | 'open_all';
  priority?: Priority;
  crmContactId?: string;
  partyId?: string;
  limit?: number;
}

export async function listIssues(ctx: CoreCtx, f: IssueFilters = {}): Promise<SupportIssue[]> {
  return withOrgCore(ctx, (tx) => {
    const conds = [eq(supportIssues.orgId, ctx.tenantId)];
    if (f.status === 'open_all') conds.push(sql`${supportIssues.status} in ('open','replied','on_hold')`);
    else if (f.status) conds.push(eq(supportIssues.status, f.status));
    if (f.priority) conds.push(eq(supportIssues.priority, f.priority));
    if (f.crmContactId) conds.push(eq(supportIssues.crmContactId, f.crmContactId));
    if (f.partyId) conds.push(eq(supportIssues.partyId, f.partyId));
    return tx
      .select()
      .from(supportIssues)
      .where(and(...conds))
      .orderBy(desc(supportIssues.createdAt))
      .limit(f.limit ?? 200);
  });
}

/** Open-issue count for an entity — powers the Connections panel Support group. */
export async function issueCountForContact(ctx: CoreCtx, contactId: string): Promise<number> {
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(supportIssues)
      .where(
        and(
          eq(supportIssues.orgId, ctx.tenantId),
          eq(supportIssues.crmContactId, contactId),
          sql`${supportIssues.status} in ('open','replied','on_hold')`,
        ),
      ),
  );
  return Number(row?.n ?? 0);
}

export async function getIssue(ctx: CoreCtx, id: string): Promise<SupportIssue | null> {
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(supportIssues)
      .where(and(eq(supportIssues.id, id), eq(supportIssues.orgId, ctx.tenantId)))
      .limit(1),
  );
  return row ?? null;
}

export interface CreateIssueInput {
  subject: string;
  description?: string | null;
  priority?: Priority;
  crmContactId?: string | null;
  partyId?: string | null;
  ownerId?: string | null;
  source?: string;
  channel?: string | null;
}

export async function createIssue(ctx: CoreCtx, input: CreateIssueInput): Promise<SupportIssue> {
  const sla = await getSlaConfig(ctx);
  const priority = input.priority ?? 'medium';
  const now = new Date();
  const { responseBy, resolutionBy } = computeSlaDeadlines(sla, priority, now);
  const values: NewSupportIssue = {
    orgId: ctx.tenantId,
    subject: input.subject,
    description: input.description ?? null,
    priority,
    crmContactId: input.crmContactId ?? null,
    partyId: input.partyId ?? null,
    ownerId: input.ownerId ?? null,
    source: input.source ?? 'manual',
    channel: input.channel ?? null,
    responseBy,
    resolutionBy,
  };
  const [row] = await withOrgCore(ctx, async (tx) => {
    const humanId = await nextSerialId(tx, ctx.tenantId, 'TKT-.YYYY.-', now);
    return tx.insert(supportIssues).values({ ...values, humanId }).returning();
  });
  return row;
}

export interface UpdateIssueInput {
  subject?: string;
  description?: string | null;
  status?: IssueStatus;
  priority?: Priority;
  ownerId?: string | null;
}

/**
 * Patch an issue. Status transitions stamp the SLA timers: the first move OFF
 * 'open' sets first_responded_at (response SLA met); 'resolved' sets
 * resolved_at; 'closed' sets closed_at. A priority change re-derives the
 * still-pending deadlines from now.
 */
export async function updateIssue(
  ctx: CoreCtx,
  id: string,
  input: UpdateIssueInput,
): Promise<SupportIssue | null> {
  return withOrgCore(ctx, async (tx) => {
    const [cur] = await tx
      .select()
      .from(supportIssues)
      .where(and(eq(supportIssues.id, id), eq(supportIssues.orgId, ctx.tenantId)))
      .limit(1);
    if (!cur) return null;

    const now = new Date();
    const patch: Partial<NewSupportIssue> = { updatedAt: now };
    if (input.subject !== undefined) patch.subject = input.subject;
    if (input.description !== undefined) patch.description = input.description;
    if (input.ownerId !== undefined) patch.ownerId = input.ownerId;

    if (input.priority && input.priority !== cur.priority) {
      patch.priority = input.priority;
      // Re-derive deadlines that haven't been met yet.
      const sla = await getSlaConfig(ctx);
      const d = computeSlaDeadlines(sla, input.priority, now);
      if (!cur.firstRespondedAt) patch.responseBy = d.responseBy;
      if (!cur.resolvedAt) patch.resolutionBy = d.resolutionBy;
    }

    if (input.status && input.status !== cur.status) {
      patch.status = input.status;
      if (input.status !== 'open' && !cur.firstRespondedAt) patch.firstRespondedAt = now;
      if (input.status === 'resolved' && !cur.resolvedAt) patch.resolvedAt = now;
      if (input.status === 'closed') {
        patch.closedAt = now;
        if (!cur.resolvedAt) patch.resolvedAt = now;
      }
    }

    const [row] = await tx
      .update(supportIssues)
      .set(patch)
      .where(and(eq(supportIssues.id, id), eq(supportIssues.orgId, ctx.tenantId)))
      .returning();
    return row;
  });
}

/** Dashboard counts for /support. */
export async function issueStats(ctx: CoreCtx): Promise<{
  open: number;
  breached: number;
  resolvedToday: number;
}> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = (await tx.execute(sql`
      select
        count(*) filter (where status in ('open','replied','on_hold'))::int as open,
        count(*) filter (where status in ('open','replied','on_hold')
          and ((first_responded_at is null and response_by < now())
               or resolution_by < now()))::int as breached,
        count(*) filter (where resolved_at >= date_trunc('day', now()))::int as resolved_today
      from support_issues
      where org_id = current_setting('app.current_org_id', true)
    `)) as unknown as Array<{ open: number; breached: number; resolved_today: number }>;
    return {
      open: Number(row?.open ?? 0),
      breached: Number(row?.breached ?? 0),
      resolvedToday: Number(row?.resolved_today ?? 0),
    };
  });
}
