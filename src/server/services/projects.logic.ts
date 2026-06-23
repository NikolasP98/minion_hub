import type { ProjectTemplateSpec } from '$server/db/pg-projects-schema';

/**
 * Pure logic for the Projects module — no DB, no I/O, so it is unit-testable in
 * isolation. The service layer maps the temp refs below to real UUIDs at insert.
 */

/** % complete = done / countable, where milestones and cancelled tasks don't count. */
export function computeProjectProgress(
  tasks: Array<{ status: string; isMilestone?: boolean | null }>,
): { percent: number; done: number; total: number } {
  const countable = tasks.filter((t) => !t.isMilestone && t.status !== 'cancelled');
  const done = countable.filter((t) => t.status === 'done').length;
  const total = countable.length;
  const percent = total === 0 ? 0 : Math.round((100 * done) / total);
  return { percent, done, total };
}

export interface PlannedMilestone {
  tempKey: string;
  name: string;
  description: string | null;
  targetDate: string | null; // YYYY-MM-DD
}
export interface PlannedTask {
  tempRef: string | null;
  title: string;
  description: string | null;
  priority: string;
  milestoneKey: string | null;
  parentRef: string | null;
  estMinutes: number | null;
  targetDate: string | null;
}
export interface TemplatePlan {
  milestones: PlannedMilestone[];
  tasks: PlannedTask[]; // parents always precede children
  warnings: string[];
}

function addDays(baseDateISO: string, days: number): string {
  const d = new Date(`${baseDateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Normalize a template spec into an ordered, validated insert plan. Resolves
 * milestone/parent refs, computes target dates from offsetDays, and topologically
 * orders tasks so a parent is always inserted before its children. Unresolvable
 * refs are nulled with a warning rather than throwing — a bad template should
 * degrade, not abort the whole instantiate.
 *
 * ponytail: O(n²) parent resolution. Templates are tiny (tens of tasks); swap to
 * a proper toposort only if someone ships a 1000-task template.
 */
export function planTemplateInstantiation(spec: ProjectTemplateSpec, baseDateISO: string | null): TemplatePlan {
  const warnings: string[] = [];

  const milestoneKeys = new Set<string>();
  const milestones: PlannedMilestone[] = [];
  for (const m of spec.milestones ?? []) {
    if (!m?.key || !m.name) {
      warnings.push(`milestone skipped: missing key/name`);
      continue;
    }
    if (milestoneKeys.has(m.key)) {
      warnings.push(`duplicate milestone key "${m.key}" — keeping the first`);
      continue;
    }
    milestoneKeys.add(m.key);
    milestones.push({
      tempKey: m.key,
      name: m.name,
      description: m.description ?? null,
      targetDate: baseDateISO != null && m.offsetDays != null ? addDays(baseDateISO, m.offsetDays) : null,
    });
  }

  const rawTasks = (spec.tasks ?? []).filter((t) => t?.title);
  const taskRefs = new Set(rawTasks.map((t) => t.ref).filter((r): r is string => typeof r === 'string'));

  const normalized: PlannedTask[] = rawTasks.map((t) => {
    let milestoneKey = t.milestoneKey ?? null;
    if (milestoneKey != null && !milestoneKeys.has(milestoneKey)) {
      warnings.push(`task "${t.title}" references unknown milestone "${milestoneKey}" — dropped`);
      milestoneKey = null;
    }
    let parentRef = t.parentRef ?? null;
    if (parentRef != null && (!taskRefs.has(parentRef) || parentRef === t.ref)) {
      warnings.push(`task "${t.title}" has unresolved/self parentRef "${parentRef}" — dropped`);
      parentRef = null;
    }
    return {
      tempRef: t.ref ?? null,
      title: t.title,
      description: t.description ?? null,
      priority: t.priority ?? 'medium',
      milestoneKey,
      parentRef,
      estMinutes: t.estMinutes ?? null,
      targetDate: baseDateISO != null && t.offsetDays != null ? addDays(baseDateISO, t.offsetDays) : null,
    };
  });

  // Order parents before children. Emit roots first, then any task whose parent
  // is already emitted; leftover cycles get their parent nulled + a warning.
  const ordered: PlannedTask[] = [];
  const emitted = new Set<string>();
  let remaining = [...normalized];
  let progressed = true;
  while (remaining.length && progressed) {
    progressed = false;
    const next: PlannedTask[] = [];
    for (const task of remaining) {
      const ready = task.parentRef == null || emitted.has(task.parentRef);
      if (ready) {
        ordered.push(task);
        if (task.tempRef) emitted.add(task.tempRef);
        progressed = true;
      } else {
        next.push(task);
      }
    }
    remaining = next;
  }
  for (const task of remaining) {
    warnings.push(`task "${task.title}" parent cycle — flattened to root`);
    ordered.push({ ...task, parentRef: null });
  }

  return { milestones, tasks: ordered, warnings };
}
