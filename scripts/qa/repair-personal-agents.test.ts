import { describe, expect, it } from 'vitest';
import { qaPersonalAgentNeedsRepair } from './repair-personal-agents';

const valid = {
  agent_id: 'personal-user-1',
  agent_display_name: 'QA agent',
  provisioning_status: 'active',
  personal_agent_id: 'personal-user-1',
};

describe('qaPersonalAgentNeedsRepair', () => {
  it('leaves a complete active fixture unchanged', () => {
    expect(qaPersonalAgentNeedsRepair(valid)).toBe(false);
  });

  it.each([
    { ...valid, agent_display_name: '' },
    { ...valid, agent_display_name: '   ' },
    { ...valid, agent_id: '' },
    { ...valid, provisioning_status: 'error' },
    { ...valid, personal_agent_id: null },
  ])('detects incomplete or nonactive fixtures %#', (candidate) => {
    expect(qaPersonalAgentNeedsRepair(candidate)).toBe(true);
  });
});
