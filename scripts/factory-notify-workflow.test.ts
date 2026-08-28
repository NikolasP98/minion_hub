import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

/**
 * Contract over the shipped `.github/workflows` files.
 *
 * The board reads a deploy tip's check state when the factory reconcile sweep is
 * poked. A poke that fires on `push` alone always lands while CI is still
 * in-flight (measured: poke done in 6-11s, CI concludes 2m39s-3m25s later, 6/6
 * consecutive master pushes ending at 1b47e8c), so the board records an
 * unsettled read and - the pipeline writing forward only - never revises it.
 * That is how 1b47e8c came to be reported as "failing CI" with every check
 * green. These assertions pin the properties that keep that from recurring.
 */

type Workflow = {
  name?: string;
  on?: Record<string, { workflows?: string[]; types?: string[]; branches?: string[] }>;
  jobs?: Record<string, { if?: string; steps?: Array<{ if?: string; run?: string }> }>;
};

function loadWorkflow(file: string): Workflow {
  return yaml.load(readFileSync(resolve('.github/workflows', file), 'utf8')) as Workflow;
}

const notify = loadWorkflow('factory-notify.yml');
const ci = loadWorkflow('ci.yml');

describe('Factory Notify workflow', () => {
  it('pokes the reconcile sweep once CI has concluded, not only on push', () => {
    expect(notify.on?.workflow_run?.types).toEqual(['completed']);
  });

  it('names a CI workflow that actually exists, so a rename cannot silently unhook it', () => {
    // The linkage is by display name. Renaming ci.yml's `name:` without updating
    // this list drops the completion poke with no error anywhere - the board
    // quietly reverts to reading in-flight check state.
    expect(notify.on?.workflow_run?.workflows).toContain(ci.name);
  });

  it('keeps the push trigger so intake still reacts immediately to a new tip', () => {
    expect(notify.on?.push?.branches).toEqual(['master']);
  });

  it('scopes the completion poke to master so PR-branch CI runs do not poke', () => {
    expect(notify.on?.workflow_run?.branches).toEqual(['master']);
  });

  it('does not gate the poke on a successful conclusion', () => {
    // A red tip has to reconcile too. Gating on success would leave the board
    // able to learn only about passing builds, hiding real failures entirely.
    const poke = notify.jobs?.poke;
    const conditions = [poke?.if, ...(poke?.steps ?? []).map((step) => step.if)].filter(
      (value): value is string => typeof value === 'string',
    );
    expect(conditions.filter((value) => value.includes('conclusion'))).toEqual([]);
  });
});
