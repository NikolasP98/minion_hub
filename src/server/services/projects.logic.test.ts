import { describe, it, expect } from 'vitest';
import { computeProjectProgress, planTemplateInstantiation } from './projects.logic';

describe('computeProjectProgress', () => {
  it('ignores milestones and cancelled tasks in the denominator', () => {
    const r = computeProjectProgress([
      { status: 'done' },
      { status: 'done' },
      { status: 'in_progress' },
      { status: 'cancelled' }, // excluded
      { status: 'todo', isMilestone: true }, // excluded
    ]);
    expect(r).toEqual({ percent: 67, done: 2, total: 3 });
  });

  it('is 0% for an empty / all-excluded project', () => {
    expect(computeProjectProgress([]).percent).toBe(0);
    expect(computeProjectProgress([{ status: 'todo', isMilestone: true }]).percent).toBe(0);
  });
});

describe('planTemplateInstantiation', () => {
  it('orders parents before children and resolves milestone/parent refs', () => {
    const plan = planTemplateInstantiation(
      {
        milestones: [{ key: 'm1', name: 'Kickoff', offsetDays: 7 }],
        tasks: [
          { ref: 'child', title: 'Child', parentRef: 'parent', milestoneKey: 'm1' },
          { ref: 'parent', title: 'Parent', milestoneKey: 'm1' },
        ],
      },
      '2026-01-01',
    );
    expect(plan.milestones[0].targetDate).toBe('2026-01-08');
    // parent must come first despite being listed second
    expect(plan.tasks.map((t) => t.title)).toEqual(['Parent', 'Child']);
    expect(plan.tasks[1].parentRef).toBe('parent');
    expect(plan.warnings).toEqual([]);
  });

  it('degrades bad refs to warnings instead of throwing', () => {
    const plan = planTemplateInstantiation(
      {
        tasks: [
          { ref: 'a', title: 'A', milestoneKey: 'nope', parentRef: 'a' }, // unknown milestone + self-parent
          { title: 'B', parentRef: 'ghost' }, // unknown parent
        ],
      },
      null,
    );
    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks[0].milestoneKey).toBeNull();
    expect(plan.tasks[0].parentRef).toBeNull();
    expect(plan.tasks[1].parentRef).toBeNull();
    expect(plan.warnings.length).toBe(3);
  });

  it('breaks a parent cycle by flattening to root', () => {
    const plan = planTemplateInstantiation(
      {
        tasks: [
          { ref: 'x', title: 'X', parentRef: 'y' },
          { ref: 'y', title: 'Y', parentRef: 'x' },
        ],
      },
      null,
    );
    expect(plan.tasks).toHaveLength(2);
    expect(plan.warnings.some((w) => w.includes('cycle'))).toBe(true);
  });
});
