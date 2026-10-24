import { describe, expect, it } from 'vitest';
import { AGENT_SETTINGS } from './agent-settings-schema';

describe('AGENT_SETTINGS', () => {
  it('has no per-agent session.reset: the gateway AgentEntrySchema rejects it (spec 035 H1)', () => {
    expect(AGENT_SETTINGS.some((s) => s.key === 'session.reset')).toBe(false);
  });
});
