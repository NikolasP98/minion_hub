import { describe, it, expect } from 'vitest';
import { median, deltaPct, costOutliers, assembleActions } from './insights.service';

describe('median', () => {
  it('handles odd and even lengths', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it('is zero on empty', () => {
    expect(median([])).toBe(0);
  });
});

describe('deltaPct', () => {
  it('returns null with no baseline', () => {
    expect(deltaPct(10, 0)).toBeNull();
  });
  it('computes percent change', () => {
    expect(deltaPct(15, 10)).toBe(50);
    expect(deltaPct(5, 10)).toBe(-50);
  });
});

describe('costOutliers', () => {
  it('flags a peak ≥3× median above the floor, ignores <3-day agents', () => {
    const rows = [
      // agent A: median day ~100k, one 5× spike above the 50k floor
      { agentId: 'A', day: '1', tokens: 100_000 },
      { agentId: 'A', day: '2', tokens: 110_000 },
      { agentId: 'A', day: '3', tokens: 90_000 },
      { agentId: 'A', day: '4', tokens: 100_000 },
      { agentId: 'A', day: '5', tokens: 500_000 },
      // agent B: only 2 days → skipped
      { agentId: 'B', day: '1', tokens: 1 },
      { agentId: 'B', day: '2', tokens: 9_999_999 },
    ];
    const out = costOutliers(rows);
    expect(out.map((o) => o.agentId)).toEqual(['A']);
    expect(out[0].tokens).toBe(500_000);
    expect(out[0].ratio).toBeGreaterThanOrEqual(3);
  });
  it('ignores spikes below the absolute floor even at high ratio', () => {
    // 10× ratio but the peak (200 tokens) is trivial → not worth an action
    expect(costOutliers([
      { agentId: 'C', day: '1', tokens: 20 },
      { agentId: 'C', day: '2', tokens: 20 },
      { agentId: 'C', day: '3', tokens: 200 },
    ])).toEqual([]);
  });
});

describe('assembleActions', () => {
  const now = 1_700_000_000_000;
  it('flags a noise-source event and ranks critical first', () => {
    const actions = assembleActions(
      { total: 1000, noise: 900, signal: 100 },
      [{ event: 'gateway.perf_snapshot', category: 'gateway', severity: 'info', n: 300 }],
      [{ event: 'channel.error', msgKey: 'boom', severity: 'critical', n: 40, prevN: 10, deltaPct: 300 }],
      [{ category: 'auth', current: 0.3, baseline: 0.05, ratio: 6 }],
      [{ agentId: 'z', tokens: 9000, baseline: 1000, ratio: 9 }],
      [{ hourBucket: '2026-07-17T03:00', n: 55 }],
      now,
    );
    // critical (recurring channel.error + health_regression ratio>=3) sorted before info (noise_source)
    expect(actions[0].severity).toBe('critical');
    const detectors = actions.map((a) => a.detector);
    expect(detectors).toContain('noise_source');
    expect(detectors).toContain('recurring_failure');
    expect(detectors).toContain('health_regression');
    expect(detectors).toContain('cost_outlier');
    expect(detectors).toContain('reconnect_storm');
    // ids are stable/deterministic (localStorage dismissal key)
    expect(actions.find((a) => a.detector === 'noise_source')?.id).toBe('noise_source:gateway.perf_snapshot');
  });
  it('does not flag a sub-threshold or signal-severity event as noise', () => {
    const actions = assembleActions(
      { total: 1000, noise: 100, signal: 900 },
      [
        { event: 'small.event', category: 'x', severity: 'info', n: 50 }, // 5% < 15%
        { event: 'agent.run.end', category: 'agent', severity: 'high', n: 300 }, // signal severity
      ],
      [], [], [], [], now,
    );
    expect(actions.filter((a) => a.detector === 'noise_source')).toHaveLength(0);
  });
});
