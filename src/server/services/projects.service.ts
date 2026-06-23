import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import { workforceClientForOrg } from '$lib/server/workforce-fetch';
import {
  projProjects,
  projTasks,
  projTimesheets,
  projTemplates,
  type ProjProject,
  type ProjTask,
  type ProjTimesheet,
  type ProjTemplate,
  type ProjectTemplateSpec,
} from '$server/db/pg-projects-schema';
import { parties } from '$server/db/pg-party-schema';
import { nextSerialId } from './naming-series';
import { recordAudit } from './activity.service';
import { computeProjectProgress, planTemplateInstantiation } from './projects.logic';
import type { CoreCtx } from '$server/auth/core-ctx';

export type ProjectStatus = 'open' | 'active' | 'on_hold' | 'completed' | 'cancelled';
export const PROJECT_STATUSES: ProjectStatus[] = ['open', 'active', 'on_hold', 'completed', 'cancelled'];
export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'blocked' | 'cancelled';
export const TASK_STATUSES: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled'];
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

type Actor = { id: string | null; name: string | null };

// ── parties: agents as parties ───────────────────────────────────────────────
/**
 * Upsert the party that represents a gateway agent (type='agent', keyed by
 * agent_id). Idempotent via the partial-unique (org_id, agent_id) index — the
 * same raw-upsert shape as naming-series so the insert and the bump race safely.
 */
export async function ensureAgentParty(ctx: CoreCtx, agentId: string, name?: string | null): Promise<string> {
  return withOrgCore(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      insert into parties (org_id, type, name, agent_id)
      values (${ctx.tenantId}, 'agent', ${name ?? agentId}, ${agentId})
      on conflict (org_id, agent_id) where agent_id is not null
      do update set name = coalesce(excluded.name, parties.name), updated_at = now()
      returning id
    `)) as unknown as Array<{ id: string }>;
    return rows[0]!.id;
  });
}

/**
 * The party representing the current hub user (type='person', keyed by
 * metadata.userId). Created on first use — this is how human users enter the
 * spine as parties so they can be assignees / log timesheets alongside agents.
 */
export async function ensureSelfParty(
  ctx: CoreCtx,
  user: { id: string; email?: string | null; name?: string | null },
): Promise<string> {
  return withOrgCore(ctx, async (tx) => {
    const [existing] = await tx
      .select({ id: parties.id })
      .from(parties)
      .where(and(eq(parties.orgId, ctx.tenantId), sql`metadata->>'userId' = ${user.id}`))
      .limit(1);
    if (existing) return existing.id;
    const [row] = await tx
      .insert(parties)
      .values({
        orgId: ctx.tenantId,
        type: 'person',
        name: user.name ?? user.email ?? 'User',
        email: user.email ?? null,
        metadata: { userId: user.id },
      })
      .returning({ id: parties.id });
    return row.id;
  });
}

/** True when the party is an agent — used to decide whether to dispatch work. */
async function partyAgentId(tx: CoreTx, orgId: string, partyId: string): Promise<string | null> {
  const [row] = await tx
    .select({ agentId: parties.agentId })
    .from(parties)
    .where(and(eq(parties.id, partyId), eq(parties.orgId, orgId)))
    .limit(1);
  return row?.agentId ?? null;
}

/** The slice of the workforce client the dispatcher uses (kept narrow so the
 *  sequence is unit-testable with a tiny fake). The real WorkforceClient
 *  satisfies it structurally. */
export interface AgentDispatchClient {
  companies: { get(id: string): Promise<unknown> };
  issues: {
    create(companyId: string, data: Record<string, unknown>): Promise<{ id: string }>;
    update(id: string, data: Record<string, unknown>): Promise<unknown>;
  };
  agents: { wakeup(id: string, data: Record<string, unknown>, companyId?: string): Promise<unknown> };
}

/**
 * The bridge sequence: create the workforce issue (assigned to the agent), make
 * sure the assignee stuck, then wake the agent so its runtime picks it up.
 * Returns the workforce issue id (or null if create yielded nothing). Pure of
 * the hub DB so it can be tested with a fake client; companies.get + update +
 * wakeup are best-effort (their failures don't abort the dispatch).
 */
export async function performAgentDispatch(
  client: AgentDispatchClient,
  orgId: string,
  task: { id: string; title: string; description: string | null; humanId: string | null },
  agentId: string,
): Promise<string | null> {
  await client.companies.get(orgId).catch(() => null); // tolerate not-yet-provisioned company
  const issue = await client.issues.create(orgId, {
    title: task.title,
    description: task.description ?? undefined,
    assigneeAgentId: agentId,
  });
  if (!issue?.id) return null;
  await client.issues.update(issue.id, { assigneeAgentId: agentId }).catch(() => null);
  await client.agents
    .wakeup(agentId, { source: 'assignment', triggerDetail: 'system', reason: `Projects task ${task.humanId ?? task.id}` }, orgId)
    .catch(() => null);
  return issue.id;
}

/**
 * Fires when a task is assigned to an agent-party: records the dispatch intent,
 * runs the bridge sequence, and links the workforce issue id back onto the task.
 * Best-effort — no company / runtime down / no creds is swallowed so the
 * assignment always stands.
 *
 * ponytail ceiling: one-way create+wake, no status sync back from the workforce
 * issue → the hub task (the task is the human-facing record). Add a webhook/poll
 * to reflect issue completion onto the task only if someone needs a live mirror.
 */
async function dispatchToAgent(ctx: CoreCtx, task: ProjTask, agentId: string, actor: Actor): Promise<void> {
  await recordAudit(ctx, {
    refType: 'proj_task',
    refId: task.id,
    op: 'dispatch',
    changes: [{ field: 'assignee', label: 'Dispatched to agent', old: null, new: agentId }],
    actor,
  });
  try {
    const client = await workforceClientForOrg(ctx.tenantId, actor);
    const issueId = await performAgentDispatch(client, ctx.tenantId, task, agentId);
    if (!issueId) return;
    const meta = task.metadata && typeof task.metadata === 'object' ? (task.metadata as Record<string, unknown>) : {};
    await withOrgCore(ctx, (tx) =>
      tx
        .update(projTasks)
        .set({ metadata: { ...meta, workforceIssueId: issueId }, updatedAt: new Date() })
        .where(and(eq(projTasks.id, task.id), eq(projTasks.orgId, ctx.tenantId))),
    );
  } catch {
    // Swallowed by design — the assignment stands; the workforce run is best-effort delivery.
  }
}

export type PartyLite = { id: string; name: string | null; type: string; agentId: string | null };

/** Agent-parties (bounded — there are few). Primary assignee options. */
export function listAgentParties(ctx: CoreCtx): Promise<PartyLite[]> {
  return withOrgCore(ctx, (tx) =>
    tx
      .select({ id: parties.id, name: parties.name, type: parties.type, agentId: parties.agentId })
      .from(parties)
      .where(and(eq(parties.orgId, ctx.tenantId), eq(parties.type, 'agent')))
      .orderBy(asc(parties.name)),
  );
}

/** Resolve a set of party ids → lite rows (for name display). */
export function partiesByIds(ctx: CoreCtx, ids: string[]): Promise<PartyLite[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return Promise.resolve([]);
  return withOrgCore(ctx, (tx) =>
    tx
      .select({ id: parties.id, name: parties.name, type: parties.type, agentId: parties.agentId })
      .from(parties)
      .where(and(eq(parties.orgId, ctx.tenantId), inArray(parties.id, unique))),
  );
}

// ── projects ─────────────────────────────────────────────────────────────────
export function listProjects(
  ctx: CoreCtx,
  f: { status?: ProjectStatus; customerPartyId?: string; limit?: number } = {},
): Promise<ProjProject[]> {
  return withOrgCore(ctx, (tx) => {
    const conds = [eq(projProjects.orgId, ctx.tenantId)];
    if (f.status) conds.push(eq(projProjects.status, f.status));
    if (f.customerPartyId) conds.push(eq(projProjects.customerPartyId, f.customerPartyId));
    return tx
      .select()
      .from(projProjects)
      .where(and(...conds))
      .orderBy(desc(projProjects.createdAt))
      .limit(f.limit ?? 200);
  });
}

export function getProject(ctx: CoreCtx, id: string): Promise<ProjProject | null> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(projProjects)
      .where(and(eq(projProjects.id, id), eq(projProjects.orgId, ctx.tenantId)))
      .limit(1);
    return row ?? null;
  });
}

export type NewProjectInput = {
  name: string;
  description?: string | null;
  status?: ProjectStatus;
  customerPartyId?: string | null;
  leadPartyId?: string | null;
  color?: string | null;
  icon?: string | null;
  targetDate?: string | null;
};

export function createProject(ctx: CoreCtx, data: NewProjectInput, actor: Actor): Promise<ProjProject> {
  return withOrgCore(ctx, async (tx) => {
    const humanId = await nextSerialId(tx, ctx.tenantId, 'PRJ-.YYYY.-', new Date());
    const [row] = await tx
      .insert(projProjects)
      .values({
        orgId: ctx.tenantId,
        humanId,
        name: data.name,
        description: data.description ?? null,
        status: data.status ?? 'open',
        customerPartyId: data.customerPartyId ?? null,
        leadPartyId: data.leadPartyId ?? null,
        color: data.color ?? null,
        icon: data.icon ?? null,
        targetDate: data.targetDate ?? null,
      })
      .returning();
    await recordAudit(ctx, {
      refType: 'proj_project',
      refId: row.id,
      op: 'create',
      changes: [{ field: 'name', label: 'Name', old: null, new: row.name }],
      actor,
    });
    return row;
  });
}

export function updateProject(
  ctx: CoreCtx,
  id: string,
  patch: Partial<NewProjectInput>,
  actor: Actor,
): Promise<ProjProject | null> {
  return withOrgCore(ctx, async (tx) => {
    const [cur] = await tx
      .select()
      .from(projProjects)
      .where(and(eq(projProjects.id, id), eq(projProjects.orgId, ctx.tenantId)))
      .limit(1);
    if (!cur) return null;
    const set: Record<string, unknown> = { updatedAt: new Date() };
    const changes = diffFields(cur as Record<string, unknown>, patch, ['name', 'description', 'status', 'customerPartyId', 'leadPartyId', 'targetDate', 'color', 'icon']);
    for (const c of changes) set[c.field] = (patch as Record<string, unknown>)[c.field];
    if (patch.status === 'completed' && cur.status !== 'completed') set.completedAt = new Date();
    const [row] = await tx
      .update(projProjects)
      .set(set)
      .where(and(eq(projProjects.id, id), eq(projProjects.orgId, ctx.tenantId)))
      .returning();
    if (changes.length) await recordAudit(ctx, { refType: 'proj_project', refId: id, changes, actor });
    return row ?? null;
  });
}

// ── tasks ────────────────────────────────────────────────────────────────────
export function listTasks(
  ctx: CoreCtx,
  f: { projectId?: string; assigneePartyId?: string; status?: TaskStatus; includeMilestones?: boolean } = {},
): Promise<ProjTask[]> {
  return withOrgCore(ctx, (tx) => {
    const conds = [eq(projTasks.orgId, ctx.tenantId)];
    if (f.projectId) conds.push(eq(projTasks.projectId, f.projectId));
    if (f.assigneePartyId) conds.push(eq(projTasks.assigneePartyId, f.assigneePartyId));
    if (f.status) conds.push(eq(projTasks.status, f.status));
    if (!f.includeMilestones) conds.push(eq(projTasks.isMilestone, false));
    return tx
      .select()
      .from(projTasks)
      .where(and(...conds))
      .orderBy(asc(projTasks.sortOrder), asc(projTasks.createdAt));
  });
}

export type NewTaskInput = {
  projectId: string;
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneePartyId?: string | null;
  parentId?: string | null;
  milestoneId?: string | null;
  isMilestone?: boolean;
  estMinutes?: number | null;
  sortOrder?: number;
};

export function createTask(ctx: CoreCtx, data: NewTaskInput, actor: Actor): Promise<ProjTask> {
  return withOrgCore(ctx, async (tx) => {
    const humanId = await nextSerialId(tx, ctx.tenantId, 'TASK-.YYYY.-', new Date());
    const [row] = await tx
      .insert(projTasks)
      .values({
        orgId: ctx.tenantId,
        projectId: data.projectId,
        humanId,
        title: data.title,
        description: data.description ?? null,
        status: data.status ?? 'backlog',
        priority: data.priority ?? 'medium',
        assigneePartyId: data.assigneePartyId ?? null,
        parentId: data.parentId ?? null,
        milestoneId: data.milestoneId ?? null,
        isMilestone: data.isMilestone ?? false,
        estMinutes: data.estMinutes ?? null,
        sortOrder: data.sortOrder ?? 0,
      })
      .returning();
    await recordAudit(ctx, {
      refType: 'proj_task',
      refId: row.id,
      op: 'create',
      changes: [{ field: 'title', label: 'Title', old: null, new: row.title }],
      actor,
    });
    if (row.assigneePartyId) {
      const agentId = await partyAgentId(tx, ctx.tenantId, row.assigneePartyId);
      if (agentId) await dispatchToAgent(ctx, row, agentId, actor);
    }
    return row;
  });
}

export function updateTask(
  ctx: CoreCtx,
  id: string,
  patch: Partial<NewTaskInput>,
  actor: Actor,
): Promise<ProjTask | null> {
  return withOrgCore(ctx, async (tx) => {
    const [cur] = await tx
      .select()
      .from(projTasks)
      .where(and(eq(projTasks.id, id), eq(projTasks.orgId, ctx.tenantId)))
      .limit(1);
    if (!cur) return null;
    const set: Record<string, unknown> = { updatedAt: new Date() };
    const changes = diffFields(cur as Record<string, unknown>, patch, ['title', 'description', 'status', 'priority', 'assigneePartyId', 'parentId', 'milestoneId', 'estMinutes', 'sortOrder']);
    for (const c of changes) set[c.field] = (patch as Record<string, unknown>)[c.field];
    // Status lifecycle side-effects.
    if (patch.status && patch.status !== cur.status) {
      if (patch.status === 'in_progress' && !cur.startedAt) set.startedAt = new Date();
      if (patch.status === 'done') set.completedAt = new Date();
      if (patch.status === 'cancelled') set.cancelledAt = new Date();
    }
    const [row] = await tx
      .update(projTasks)
      .set(set)
      .where(and(eq(projTasks.id, id), eq(projTasks.orgId, ctx.tenantId)))
      .returning();
    if (changes.length) await recordAudit(ctx, { refType: 'proj_task', refId: id, changes, actor });
    // Dispatch when assignee changed to an agent-party.
    if (row && patch.assigneePartyId && patch.assigneePartyId !== cur.assigneePartyId) {
      const agentId = await partyAgentId(tx, ctx.tenantId, patch.assigneePartyId);
      if (agentId) await dispatchToAgent(ctx, row, agentId, actor);
    }
    return row ?? null;
  });
}

// ── timesheets ───────────────────────────────────────────────────────────────
export function listTimesheets(
  ctx: CoreCtx,
  f: { projectId?: string; taskId?: string; partyId?: string; limit?: number } = {},
): Promise<ProjTimesheet[]> {
  return withOrgCore(ctx, (tx) => {
    const conds = [eq(projTimesheets.orgId, ctx.tenantId)];
    if (f.projectId) conds.push(eq(projTimesheets.projectId, f.projectId));
    if (f.taskId) conds.push(eq(projTimesheets.taskId, f.taskId));
    if (f.partyId) conds.push(eq(projTimesheets.partyId, f.partyId));
    return tx
      .select()
      .from(projTimesheets)
      .where(and(...conds))
      .orderBy(desc(projTimesheets.spentDate))
      .limit(f.limit ?? 500);
  });
}

export type NewTimesheetInput = {
  projectId?: string | null;
  taskId?: string | null;
  partyId: string;
  spentDate: string;
  minutes: number;
  description?: string | null;
  billable?: boolean;
  billingRateCents?: number | null;
};

export function createTimesheet(ctx: CoreCtx, data: NewTimesheetInput): Promise<ProjTimesheet> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .insert(projTimesheets)
      .values({
        orgId: ctx.tenantId,
        projectId: data.projectId ?? null,
        taskId: data.taskId ?? null,
        partyId: data.partyId,
        spentDate: data.spentDate,
        minutes: data.minutes,
        description: data.description ?? null,
        billable: data.billable ?? false,
        billingRateCents: data.billingRateCents ?? null,
      })
      .returning();
    return row;
  });
}

// ── templates ────────────────────────────────────────────────────────────────
export function listTemplates(ctx: CoreCtx): Promise<ProjTemplate[]> {
  return withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(projTemplates)
      .where(and(eq(projTemplates.orgId, ctx.tenantId), sql`archived_at is null`))
      .orderBy(asc(projTemplates.name)),
  );
}

export function createTemplate(
  ctx: CoreCtx,
  data: { name: string; description?: string | null; spec: ProjectTemplateSpec },
): Promise<ProjTemplate> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .insert(projTemplates)
      .values({ orgId: ctx.tenantId, name: data.name, description: data.description ?? null, spec: data.spec })
      .returning();
    return row;
  });
}

/**
 * Instantiate a template into a project + milestone-tasks + tasks. Uses the
 * tested pure planner for ordering/ref-resolution, then maps its temp keys/refs
 * to the real UUIDs produced as we insert (milestones first, then tasks in
 * parent-before-child order). Returns the created project + any planner warnings.
 */
export async function instantiateTemplate(
  ctx: CoreCtx,
  templateId: string,
  opts: { name?: string; customerPartyId?: string | null; leadPartyId?: string | null; baseDate?: string | null },
  actor: Actor,
): Promise<{ project: ProjProject; warnings: string[] } | null> {
  return withOrgCore(ctx, async (tx) => {
    const [tpl] = await tx
      .select()
      .from(projTemplates)
      .where(and(eq(projTemplates.id, templateId), eq(projTemplates.orgId, ctx.tenantId)))
      .limit(1);
    if (!tpl) return null;
    const spec = tpl.spec;
    const plan = planTemplateInstantiation(spec, opts.baseDate ?? null);

    const projHumanId = await nextSerialId(tx, ctx.tenantId, 'PRJ-.YYYY.-', new Date());
    const [project] = await tx
      .insert(projProjects)
      .values({
        orgId: ctx.tenantId,
        humanId: projHumanId,
        name: opts.name ?? spec.project?.name ?? tpl.name,
        description: spec.project?.description ?? tpl.description ?? null,
        status: (spec.project?.status as ProjectStatus) ?? 'open',
        customerPartyId: opts.customerPartyId ?? null,
        leadPartyId: opts.leadPartyId ?? null,
      })
      .returning();

    // Milestones → milestone-tasks; remember key → new task id.
    const milestoneId = new Map<string, string>();
    for (const m of plan.milestones) {
      const humanId = await nextSerialId(tx, ctx.tenantId, 'TASK-.YYYY.-', new Date());
      const [row] = await tx
        .insert(projTasks)
        .values({
          orgId: ctx.tenantId,
          projectId: project.id,
          humanId,
          title: m.name,
          description: m.description,
          isMilestone: true,
          status: 'todo',
        })
        .returning({ id: projTasks.id });
      milestoneId.set(m.tempKey, row.id);
    }

    // Tasks in order; map parentRef → created id as we go.
    const taskId = new Map<string, string>();
    for (const t of plan.tasks) {
      const humanId = await nextSerialId(tx, ctx.tenantId, 'TASK-.YYYY.-', new Date());
      const [row] = await tx
        .insert(projTasks)
        .values({
          orgId: ctx.tenantId,
          projectId: project.id,
          humanId,
          title: t.title,
          description: t.description,
          priority: t.priority,
          estMinutes: t.estMinutes,
          milestoneId: t.milestoneKey ? milestoneId.get(t.milestoneKey) ?? null : null,
          parentId: t.parentRef ? taskId.get(t.parentRef) ?? null : null,
        })
        .returning({ id: projTasks.id });
      if (t.tempRef) taskId.set(t.tempRef, row.id);
    }

    await recordAudit(ctx, {
      refType: 'proj_project',
      refId: project.id,
      op: 'create',
      changes: [{ field: 'template', label: 'Instantiated from template', old: null, new: tpl.name }],
      actor,
    });
    return { project, warnings: plan.warnings };
  });
}

// ── computed reads (no tables) ────────────────────────────────────────────────
/** % complete + done/total, computed from the project's countable tasks. */
export async function getProjectProgress(
  ctx: CoreCtx,
  projectId: string,
): Promise<{ percent: number; done: number; total: number }> {
  const tasks = await withOrgCore(ctx, (tx) =>
    tx
      .select({ status: projTasks.status, isMilestone: projTasks.isMilestone })
      .from(projTasks)
      .where(and(eq(projTasks.orgId, ctx.tenantId), eq(projTasks.projectId, projectId))),
  );
  return computeProjectProgress(tasks);
}

/** Gantt feed: every task with the dates a timeline needs + milestone flags. */
export function getProjectGantt(ctx: CoreCtx, projectId: string) {
  return withOrgCore(ctx, (tx) =>
    tx
      .select({
        id: projTasks.id,
        title: projTasks.title,
        status: projTasks.status,
        isMilestone: projTasks.isMilestone,
        milestoneId: projTasks.milestoneId,
        parentId: projTasks.parentId,
        startedAt: projTasks.startedAt,
        completedAt: projTasks.completedAt,
        createdAt: projTasks.createdAt,
      })
      .from(projTasks)
      .where(and(eq(projTasks.orgId, ctx.tenantId), eq(projTasks.projectId, projectId)))
      .orderBy(asc(projTasks.sortOrder), asc(projTasks.createdAt)),
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────
type FieldChange = { field: string; label: string; old: unknown; new: unknown };
/** Build an audit diff for the keys present in `patch` that actually changed. */
function diffFields(cur: Record<string, unknown>, patch: Record<string, unknown>, keys: string[]): FieldChange[] {
  const out: FieldChange[] = [];
  for (const field of keys) {
    if (!(field in patch)) continue;
    const next = patch[field];
    if (next === undefined) continue;
    if (cur[field] !== next) out.push({ field, label: field, old: cur[field] ?? null, new: next ?? null });
  }
  return out;
}
