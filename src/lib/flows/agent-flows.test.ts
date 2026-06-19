import { describe, it, expect } from 'vitest';
import { getMasterFlow, MASTER_FLOWS } from './master-flows';

describe('agent representative flows', () => {
  it('resolves the Reminders agent flow by id', () => {
    const flow = getMasterFlow('agent-reminders');
    expect(flow).toBeTruthy();
    expect(flow?.name).toMatch(/reminder/i);
    expect((flow?.nodes.length ?? 0)).toBeGreaterThanOrEqual(4);
  });
  it('does not list agent flows in the master-flows roster', () => {
    expect(MASTER_FLOWS.some((f) => f.id === 'agent-reminders')).toBe(false);
  });
});
