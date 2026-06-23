import { describe, it, expect } from 'vitest';
import { computeSlaDeadlines, agreementStatus, DEFAULT_SLA } from './support.service';

const T0 = new Date('2026-06-22T12:00:00Z');

describe('computeSlaDeadlines', () => {
  it('adds the priority tier minutes to the base instant', () => {
    const { responseBy, resolutionBy } = computeSlaDeadlines(DEFAULT_SLA, 'urgent', T0);
    expect(responseBy.toISOString()).toBe('2026-06-22T12:30:00.000Z'); // +30m
    expect(resolutionBy.toISOString()).toBe('2026-06-22T16:00:00.000Z'); // +240m
  });

  it('falls back to DEFAULT tier for an unknown/missing priority config', () => {
    const sparse = { priorities: {} } as never;
    const { responseBy } = computeSlaDeadlines(sparse, 'low', T0);
    expect(responseBy.toISOString()).toBe('2026-06-22T20:00:00.000Z'); // +480m
  });
});

describe('agreementStatus', () => {
  const base = { responseBy: new Date('2026-06-22T12:30:00Z'), resolutionBy: new Date('2026-06-22T16:00:00Z') };

  it('is ongoing before the response deadline', () => {
    const r = agreementStatus({ ...base, status: 'open', firstRespondedAt: null, resolvedAt: null }, new Date('2026-06-22T12:10:00Z'));
    expect(r.state).toBe('ongoing');
    expect(r.breached).toBe(false);
  });

  it('fails when past the response deadline with no first reply', () => {
    const r = agreementStatus({ ...base, status: 'open', firstRespondedAt: null, resolvedAt: null }, new Date('2026-06-22T13:00:00Z'));
    expect(r.state).toBe('failed');
    expect(r.breached).toBe(true);
  });

  it('switches the live deadline to resolution once replied', () => {
    // replied in time → response met; now before resolution → ongoing.
    const r = agreementStatus(
      { ...base, status: 'replied', firstRespondedAt: new Date('2026-06-22T12:20:00Z'), resolvedAt: null },
      new Date('2026-06-22T15:00:00Z'),
    );
    expect(r.state).toBe('ongoing');
  });

  it('is fulfilled when resolved before the resolution deadline', () => {
    const r = agreementStatus(
      { ...base, status: 'resolved', firstRespondedAt: new Date('2026-06-22T12:20:00Z'), resolvedAt: new Date('2026-06-22T15:30:00Z') },
      new Date('2026-06-22T18:00:00Z'),
    );
    expect(r.state).toBe('fulfilled');
    expect(r.breached).toBe(false);
  });

  it('is failed when resolved after the resolution deadline', () => {
    const r = agreementStatus(
      { ...base, status: 'resolved', firstRespondedAt: new Date('2026-06-22T12:20:00Z'), resolvedAt: new Date('2026-06-22T17:00:00Z') },
      new Date('2026-06-22T18:00:00Z'),
    );
    expect(r.state).toBe('failed');
  });
});
