import { describe, it, expect } from 'vitest';
import { scoreColor, stageColor, relativeTime, contactLabel } from './crm-format';

const NOW = new Date('2026-06-13T12:00:00Z');

describe('scoreColor', () => {
  it('ramps from cold to hot', () => {
    expect(scoreColor(10)).toContain('muted');
    expect(scoreColor(40)).toContain('warning');
    expect(scoreColor(60)).toContain('emerald');
    expect(scoreColor(90)).toContain('success');
  });
});

describe('stageColor', () => {
  it('maps known stages and falls back', () => {
    expect(stageColor('Churned')).toContain('destructive');
    expect(stageColor('Active')).toContain('success');
    expect(stageColor('Whatever')).toContain('muted');
  });
});

describe('relativeTime', () => {
  it('handles null and bad input', () => {
    expect(relativeTime(null, NOW)).toBe('—');
    expect(relativeTime('not-a-date', NOW)).toBe('—');
  });
  it('formats buckets', () => {
    expect(relativeTime(new Date(NOW.getTime() - 10_000), NOW)).toBe('just now');
    expect(relativeTime(new Date(NOW.getTime() - 5 * 60_000), NOW)).toBe('5m');
    expect(relativeTime(new Date(NOW.getTime() - 3 * 3_600_000), NOW)).toBe('3h');
    expect(relativeTime(new Date(NOW.getTime() - 2 * 86_400_000), NOW)).toBe('2d');
    expect(relativeTime(new Date(NOW.getTime() - 21 * 86_400_000), NOW)).toBe('3w');
  });
});

describe('contactLabel', () => {
  it('falls back on empty', () => {
    expect(contactLabel('  ')).toBe('Unknown');
    expect(contactLabel('Ana')).toBe('Ana');
  });
});
