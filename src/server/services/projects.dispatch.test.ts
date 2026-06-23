import { describe, it, expect, vi } from 'vitest';
import { performAgentDispatch, type AgentDispatchClient } from './projects.service';

/** A fake workforce client that records every call and returns canned data. */
function fakeClient(overrides: Partial<{ createReturnsId: string | null; wakeupThrows: boolean }> = {}) {
  const calls = {
    companiesGet: [] as string[],
    issuesCreate: [] as Array<{ companyId: string; data: Record<string, unknown> }>,
    issuesUpdate: [] as Array<{ id: string; data: Record<string, unknown> }>,
    wakeup: [] as Array<{ id: string; data: Record<string, unknown>; companyId?: string }>,
  };
  const client: AgentDispatchClient = {
    companies: {
      get: vi.fn(async (id: string) => {
        calls.companiesGet.push(id);
        return { id };
      }),
    },
    issues: {
      create: vi.fn(async (companyId: string, data: Record<string, unknown>) => {
        calls.issuesCreate.push({ companyId, data });
        const id = overrides.createReturnsId === undefined ? 'issue-1' : overrides.createReturnsId;
        return { id: id as string };
      }),
      update: vi.fn(async (id: string, data: Record<string, unknown>) => {
        calls.issuesUpdate.push({ id, data });
        return { id };
      }),
    },
    agents: {
      wakeup: vi.fn(async (id: string, data: Record<string, unknown>, companyId?: string) => {
        calls.wakeup.push({ id, data, companyId });
        if (overrides.wakeupThrows) throw new Error('runtime down');
        return { ok: true };
      }),
    },
  };
  return { client, calls };
}

const task = { id: 'task-1', title: 'Ship the thing', description: 'do it', humanId: 'TASK-2026-00001' };

describe('performAgentDispatch', () => {
  it('creates an assigned issue, re-asserts the assignee, and wakes the agent', async () => {
    const { client, calls } = fakeClient();
    const issueId = await performAgentDispatch(client, 'org-9', task, 'agent-7');

    expect(issueId).toBe('issue-1');
    // company resolved against the same org
    expect(calls.companiesGet).toEqual(['org-9']);
    // issue created in the org, assigned to the agent
    expect(calls.issuesCreate).toHaveLength(1);
    expect(calls.issuesCreate[0].companyId).toBe('org-9');
    expect(calls.issuesCreate[0].data).toMatchObject({ title: 'Ship the thing', assigneeAgentId: 'agent-7' });
    // assignee re-asserted on the created issue
    expect(calls.issuesUpdate).toEqual([{ id: 'issue-1', data: { assigneeAgentId: 'agent-7' } }]);
    // agent woken with an assignment-sourced trigger, scoped to the org
    expect(calls.wakeup).toHaveLength(1);
    expect(calls.wakeup[0].id).toBe('agent-7');
    expect(calls.wakeup[0].companyId).toBe('org-9');
    expect(calls.wakeup[0].data).toMatchObject({ source: 'assignment' });
  });

  it('still returns the issue id when waking the agent fails (best-effort delivery)', async () => {
    const { client } = fakeClient({ wakeupThrows: true });
    const issueId = await performAgentDispatch(client, 'org-9', task, 'agent-7');
    expect(issueId).toBe('issue-1');
  });

  it('returns null when issue creation yields no id', async () => {
    const { client, calls } = fakeClient({ createReturnsId: null });
    const issueId = await performAgentDispatch(client, 'org-9', task, 'agent-7');
    expect(issueId).toBeNull();
    expect(calls.issuesUpdate).toHaveLength(0); // no follow-up calls
    expect(calls.wakeup).toHaveLength(0);
  });
});
