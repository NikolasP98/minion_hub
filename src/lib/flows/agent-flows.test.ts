import { describe, it, expect } from 'vitest';
import { getMasterFlow, MASTER_FLOWS, flowExportedSpecs } from './master-flows';

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
  it('resolves the Alert Watcher agent flow', () => {
    const flow = getMasterFlow('agent-alert-watcher');
    expect(flow).toBeTruthy();
    expect(flow?.nodes.some((n) => n.kind === 'llm')).toBe(true);
    expect(MASTER_FLOWS.some((f) => f.id === 'agent-alert-watcher')).toBe(false);
  });

  it('Reminders flow exports non-empty and unique keys', () => {
    const flow = getMasterFlow('agent-reminders');
    expect(flow).toBeTruthy();
    const specs = flowExportedSpecs(flow!);
    expect(specs.length).toBeGreaterThan(0);
    const keys = specs.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length); // all unique
  });

  it('Alert Watcher flow exports non-empty and unique keys', () => {
    const flow = getMasterFlow('agent-alert-watcher');
    expect(flow).toBeTruthy();
    const specs = flowExportedSpecs(flow!);
    expect(specs.length).toBeGreaterThan(0);
    const keys = specs.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length); // all unique
  });
});
