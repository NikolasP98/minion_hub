import { describe, expect, test, vi } from 'vitest';
import {
  runtimeAgentIdForDraft,
  synchronizeRuntimeAgent,
  type GatewayRpc,
  type RuntimeAgentDraft,
} from './builder-agent-publisher';

const draft: RuntimeAgentDraft = {
  id: 'Draft_ABC',
  tenantId: 'org-1',
  name: 'Support Copilot',
  emoji: '🤖',
  model: 'openai/gpt-5',
  systemPrompt: 'Help the support team.',
  runtimeAgentId: null,
};

describe('runtime agent publishing', () => {
  test('first publish creates, updates, patches config, and returns a stable linkage', async () => {
    const rpc = vi.fn<GatewayRpc>(async (method: string, _params: Record<string, unknown>) => {
      if (method === 'agents.create') return { agentId: runtimeAgentIdForDraft(draft.id) };
      if (method === 'config.get') return { hash: 'h1' };
      return { ok: true };
    });
    const result = await synchronizeRuntimeAgent(draft, rpc);
    expect(result).toEqual({ runtimeAgentId: 'built-draft_abc', created: true });
    expect(rpc.mock.calls.map(([method]) => method)).toEqual([
      'agents.create',
      'agents.update',
      'config.get',
      'config.patch',
    ]);
    const patch = rpc.mock.calls.find(([method]) => method === 'config.patch')?.[1] as {
      raw: string;
    };
    expect(JSON.parse(patch.raw).agents.list[0]).toMatchObject({
      id: 'built-draft_abc',
      name: 'Support Copilot',
      orgIds: ['org-1'],
    });
  });

  test('republish updates the linked runtime without creating a second agent', async () => {
    const rpc = vi.fn<GatewayRpc>(async (method: string, _params: Record<string, unknown>) =>
      method === 'config.get' ? { hash: 'h2' } : { ok: true },
    );
    const result = await synchronizeRuntimeAgent({ ...draft, runtimeAgentId: 'runtime-1' }, rpc);
    expect(result).toEqual({ runtimeAgentId: 'runtime-1', created: false });
    expect(rpc).not.toHaveBeenCalledWith('agents.create', expect.anything());
    expect(rpc.mock.calls[0]?.[0]).toBe('agents.update');
  });

  test('a retry adopts the deterministic runtime when create reports it already exists', async () => {
    const rpc = vi.fn<GatewayRpc>(async (method: string, _params: Record<string, unknown>) => {
      if (method === 'agents.create') throw new Error('agent "built-draft_abc" already exists');
      if (method === 'config.get') return { hash: 'h3' };
      return { ok: true };
    });
    await expect(synchronizeRuntimeAgent(draft, rpc)).resolves.toMatchObject({
      runtimeAgentId: 'built-draft_abc',
      created: false,
    });
  });
});
