/** Spec 045 T038: the hub saves a member's own agent settings with its own credential. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ call: vi.fn(), prepare: vi.fn() }));
vi.mock('./personal-agent.service', () => ({
  getPersonalAgent: vi.fn(),
  provisionPersonalAgent: vi.fn(),
  updateProvisioningStatus: vi.fn(),
}));
vi.mock('$lib/server/gateway-rpc', () => ({ gatewayCallToInstance: m.call }));
vi.mock('./personal-agent-binding', async (orig) => ({
  ...(await orig<typeof import('./personal-agent-binding')>()),
  preparePersonalAgentBinding: m.prepare,
}));

import { PersonalAgentBindingError } from './personal-agent-binding';
import {
  sanitizePersonalAgentSettings,
  updatePersonalAgentSettings,
} from './personal-agent-provisioner';

const ctx = { tenantId: 'org', profileId: 'u1' } as never;

beforeEach(() => {
  m.call.mockReset();
  m.prepare.mockReset();
  m.call.mockImplementation(async (_u: string, _t: string, method: string) =>
    method === 'config.get'
      ? { hash: 'h1' }
      : method === 'agents.list'
        ? { agents: [{ id: 'other' }, { id: 'personal-u1' }] }
        : {},
  );
  m.prepare.mockResolvedValue({
    target: { url: 'ws://gw', token: 'srv-token' },
    agent: { agent_id: 'personal-u1', provisioning_status: 'active' },
  });
});

describe('sanitizePersonalAgentSettings', () => {
  it('keeps only the four editable fields and drops everything else', () => {
    expect(
      sanitizePersonalAgentSettings({
        name: ' Ana ',
        conversationName: 'Chat',
        preset: 'casual',
        text: 'be kind',
        agentId: 'someone-else',
        contextMode: 'shared',
        identity: { name: 'x' },
        __proto__: { polluted: true },
      }),
    ).toEqual({ name: 'Ana', conversationName: 'Chat', preset: 'casual', text: 'be kind' });
  });
  it('drops non-strings, oversize values and an empty name; allows clearing others', () => {
    expect(sanitizePersonalAgentSettings({ name: '', preset: 5, text: 'x'.repeat(2001) })).toEqual(
      {},
    );
    expect(sanitizePersonalAgentSettings({ preset: 'warm' })).toEqual({});
    expect(sanitizePersonalAgentSettings({ preset: '' })).toEqual({});
    expect(sanitizePersonalAgentSettings({ text: '', conversationName: '' })).toEqual({
      text: '',
      conversationName: '',
    });
    expect(sanitizePersonalAgentSettings(null)).toEqual({});
  });
});

describe('updatePersonalAgentSettings', () => {
  it('patches the caller’s own agent (from the binding), with the server credential', async () => {
    const id = await updatePersonalAgentSettings(ctx, 'u1', { name: 'Ana', preset: 'casual' });
    expect(id).toBe('personal-u1');
    expect(m.prepare).toHaveBeenCalledWith(ctx, 'u1');
    const patch = m.call.mock.calls.find(([, , method]) => method === 'config.patch')!;
    expect(patch[0]).toBe('ws://gw');
    expect(patch[1]).toBe('srv-token');
    expect(patch[3].baseHash).toBe('h1');
    expect(JSON.parse(patch[3].raw)).toEqual({
      agents: {
        list: [
          {
            id: 'personal-u1',
            identity: { name: 'Ana' },
            personality: { preset: 'casual', configured: true },
          },
        ],
      },
    });
  });
  it('a name-only edit does not mark the personality configured', async () => {
    await updatePersonalAgentSettings(ctx, 'u1', { conversationName: 'Hi' });
    const patch = m.call.mock.calls.find(([, , method]) => method === 'config.patch')!;
    expect(JSON.parse(patch[3].raw).agents.list[0]).toEqual({
      id: 'personal-u1',
      personality: { conversationName: 'Hi' },
    });
  });
  it('refuses an agent that is not active, and sends nothing for an empty edit', async () => {
    m.prepare.mockResolvedValue({
      target: { url: 'ws://gw', token: 't' },
      agent: { agent_id: 'personal-u1', provisioning_status: 'pending' },
    });
    await expect(updatePersonalAgentSettings(ctx, 'u1', { name: 'A' })).rejects.toThrow();
    expect(m.call).not.toHaveBeenCalled();
  });
  it('refuses (409-class) an agent missing from its gateway instead of adding one', async () => {
    m.call.mockImplementation(async (_u: string, _t: string, method: string) =>
      method === 'agents.list' ? { agents: [{ id: 'other' }] } : { hash: 'h1' },
    );
    await expect(updatePersonalAgentSettings(ctx, 'u1', { name: 'A' })).rejects.toBeInstanceOf(
      PersonalAgentBindingError,
    );
    expect(m.call.mock.calls.some(([, , method]) => method === 'config.patch')).toBe(false);
  });
});
