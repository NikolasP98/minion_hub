import { afterEach, describe, expect, it } from 'vitest';
import { page } from '$app/state';
import { assistant } from './assistant.svelte';

const data = page.data as Record<string, unknown>;
afterEach(() => {
  delete data.entitlements;
  delete data.personalAgent;
});

// Spec 043: without ai.chat the personal agent is absent to every client surface, so /home loads no
// chat history and renders no thread, even for an org that had an agent before a downgrade.
describe('assistant.personalAgentId and the plan', () => {
  it('is null without ai.chat even when an agent is provisioned', () => {
    data.personalAgent = { agent: { agentId: 'Agent-1' } };
    data.entitlements = { plan: 'base', features: [] };
    expect(assistant.personalAgentId).toBeNull();
  });
  it('is the lower-cased agent id with ai.chat or with no entitlements (unchanged)', () => {
    data.personalAgent = { agent: { agentId: 'Agent-1' } };
    expect(assistant.personalAgentId).toBe('agent-1');
    data.entitlements = { plan: 'premium', features: ['ai', 'ai.chat'] };
    expect(assistant.personalAgentId).toBe('agent-1');
  });
});
