import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

vi.mock('$lib/server/gateway-rpc', () => ({ gatewayCall: vi.fn() }));
vi.mock('./activity.service', () => ({ recordAudit: vi.fn(async () => {}) }));

import { gatewayCall } from '$lib/server/gateway-rpc';
import { recordAudit } from './activity.service';
import { brains, brainAccess } from '$server/db/pg-schema/brains';
import {
  renderTemplate,
  provisionBrainAgent,
  deprovisionBrainAgent,
  fanOutTemplate,
  deriveBrainAgentId,
  listBrainAgentIds,
} from './brain-agents.service';

const mockGatewayCall = vi.mocked(gatewayCall);
const mockRecordAudit = vi.mocked(recordAudit);

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });
const actor = { id: 'user-1', name: 'Admin' };

const brainRow = (over: Partial<{ id: string; name: string; description: string | null; agentId: string | null }> = {}) => ({
  id: 'brain-1',
  orgId: 'org-1',
  name: 'Support KB',
  description: null,
  icon: null,
  visibility: 'org',
  agentId: null,
  createdBy: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

const templateRow = (over: Partial<{ namePrefix: string; emoji: string | null; model: string | null; instructions: string }> = {}) => ({
  id: 'tmpl-1',
  orgId: 'org-1',
  namePrefix: 'Brain',
  emoji: null,
  model: null,
  instructions: 'You help with {{brain_name}}. {{brain_description}}',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

beforeEach(() => {
  mockGatewayCall.mockReset();
  mockRecordAudit.mockClear();
});

describe('renderTemplate (pure placeholder substitution)', () => {
  it('substitutes brain_name and brain_description', () => {
    const out = renderTemplate(
      { instructions: 'You are {{brain_name}}. {{brain_description}}' },
      { name: 'Support KB', description: 'handles refunds' },
    );
    expect(out).toBe('You are Support KB. handles refunds');
  });

  it('substitutes an empty string when the brain has no description', () => {
    const out = renderTemplate({ instructions: 'Desc: {{brain_description}}' }, { name: 'X', description: null });
    expect(out).toBe('Desc: ');
  });

  it('leaves instructions with no placeholders untouched', () => {
    expect(renderTemplate({ instructions: 'Static prompt' }, { name: 'X', description: null })).toBe('Static prompt');
  });
});

describe('deriveBrainAgentId', () => {
  it('prefixes with brain-', () => {
    expect(deriveBrainAgentId('abc-123')).toBe('brain-abc-123');
  });
});

describe('provisionBrainAgent', () => {
  it('creates the gateway agent, patches its config, and writes agent_id + a write-level brain_access row', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [brainRow({ agentId: null })], // loadBrainRow
      [templateRow()], // getTemplate
      undefined, // update(brains)
      undefined, // insert(brain_access)
    ]);
    mockGatewayCall.mockImplementation(async (method: string) => {
      if (method === 'config.get') return { hash: 'h1' };
      return { ok: true };
    });

    const result = await provisionBrainAgent(ctx(db), 'brain-1', actor);

    expect(result.agentId).toBe('brain-brain-1');
    expect(mockGatewayCall).toHaveBeenCalledWith(
      'agents.create',
      expect.objectContaining({ name: 'brain-brain-1' }),
    );
    expect(mockGatewayCall).toHaveBeenCalledWith('config.patch', expect.objectContaining({ baseHash: 'h1' }));
    expect(db.update).toHaveBeenCalledWith(brains);
    expect(db.insert).toHaveBeenCalledWith(brainAccess);
    expect(mockRecordAudit).toHaveBeenCalledTimes(1);

    // Gateway-side org scoping (org-scope.ts) — the config.patch payload's agent
    // entry must carry the brain's org id so agents.ts/org-scope.ts and the hub's
    // own listBrainAgentIds-fed roster filter agree on ownership.
    const patchCall = mockGatewayCall.mock.calls.find(([method]) => method === 'config.patch')!;
    const raw = JSON.parse((patchCall[1] as { raw: string }).raw);
    expect(raw.agents.list[0].orgIds).toEqual(['org-1']);
  });

  it('is idempotent — returns the existing agent_id without touching the gateway', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[brainRow({ agentId: 'brain-brain-2' })]]);

    const result = await provisionBrainAgent(ctx(db), 'brain-2', actor);

    expect(result.agentId).toBe('brain-brain-2');
    expect(mockGatewayCall).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it('404s when the brain does not exist', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]);
    await expect(provisionBrainAgent(ctx(db), 'missing', actor)).rejects.toMatchObject({ status: 404 });
  });

  it('tolerates an "already exists" agents.create error (partial-attempt retry)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[brainRow({ agentId: null })], [templateRow()], undefined, undefined]);
    mockGatewayCall.mockImplementation(async (method: string) => {
      if (method === 'agents.create') throw new Error('agent already exists');
      if (method === 'config.get') return { hash: 'h1' };
      return { ok: true };
    });

    const result = await provisionBrainAgent(ctx(db), 'brain-1', actor);
    expect(result.agentId).toBe('brain-brain-1');
  });
});

describe('deprovisionBrainAgent', () => {
  it('deletes the gateway agent, clears agent_id, and removes the access row', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [brainRow({ agentId: 'brain-brain-1' })], // loadBrainRow
      undefined, // update(brains)
      undefined, // delete(brain_access)
    ]);
    mockGatewayCall.mockResolvedValue({ ok: true });

    await deprovisionBrainAgent(ctx(db), 'brain-1', actor);

    expect(mockGatewayCall).toHaveBeenCalledWith('agents.delete', { agentId: 'brain-brain-1' });
    expect(db.update).toHaveBeenCalledWith(brains);
    expect(db.delete).toHaveBeenCalledWith(brainAccess);
    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the brain has no agent', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[brainRow({ agentId: null })]]);
    await deprovisionBrainAgent(ctx(db), 'brain-1', actor);
    expect(mockGatewayCall).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});

describe('fanOutTemplate (collects per-agent errors without aborting the batch)', () => {
  it('reconfigures every brain agent and reports one failure without dropping the rest', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [templateRow()], // getTemplate
      [brainRow({ id: 'brain-1', agentId: 'brain-brain-1' }), brainRow({ id: 'brain-2', agentId: 'brain-brain-2' })], // brains with agent_id
    ]);
    mockGatewayCall.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'config.get') return { hash: 'h1' };
      if (method === 'config.patch' && String(params?.raw).includes('brain-brain-2')) {
        throw new Error('gateway unreachable');
      }
      return { ok: true };
    });

    const results = await fanOutTemplate(ctx(db));

    expect(results).toHaveLength(2);
    expect(results.find((r) => r.agentId === 'brain-brain-1')).toMatchObject({ ok: true });
    expect(results.find((r) => r.agentId === 'brain-brain-2')).toMatchObject({
      ok: false,
      error: 'gateway unreachable',
    });
  });

  it('returns [] when no brain in the org has an agent', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[templateRow()], []]);
    expect(await fanOutTemplate(ctx(db))).toEqual([]);
  });
});

describe('listBrainAgentIds', () => {
  it('returns the agent ids of every provisioned brain in the org', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ agentId: 'brain-1' }, { agentId: 'brain-2' }]);
    expect(await listBrainAgentIds(ctx(db))).toEqual(['brain-1', 'brain-2']);
  });

  it('returns [] when no brain in the org has an agent', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    expect(await listBrainAgentIds(ctx(db))).toEqual([]);
  });
});
