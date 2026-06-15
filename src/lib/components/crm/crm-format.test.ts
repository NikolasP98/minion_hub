import { describe, it, expect } from 'vitest';
import {
  scoreColor,
  stageColor,
  relativeTime,
  contactLabel,
  isRecencyNever,
  identityValue,
  formatPhoneLike,
} from './crm-format';

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

describe('isRecencyNever', () => {
  it('detects the cold sentinel', () => {
    expect(isRecencyNever(1e9)).toBe(true);
    expect(isRecencyNever(null)).toBe(true);
    expect(isRecencyNever(undefined)).toBe(true);
    expect(isRecencyNever(NaN)).toBe(true);
    expect(isRecencyNever(0)).toBe(false);
    expect(isRecencyNever(45.2)).toBe(false);
  });
});

describe('identityValue', () => {
  it('prefers the external id (number) over the handle (name)', () => {
    expect(identityValue('+51924375271', 'Fiorella Andrea')).toBe('+51 924 375 271');
    expect(identityValue(null, 'Some Name')).toBe('Some Name');
    expect(identityValue('  ', '  ')).toBe('—');
  });
});

describe('formatPhoneLike', () => {
  it('groups phone numbers and leaves other ids alone', () => {
    expect(formatPhoneLike('+51924375271')).toBe('+51 924 375 271');
    expect(formatPhoneLike('51924375271')).toBe('51 924 375 271');
    expect(formatPhoneLike('user_abc123')).toBe('user_abc123');
  });
});
