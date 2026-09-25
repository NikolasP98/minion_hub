import { describe, it, expect } from 'vitest';
import { ENTRY_TYPE_BADGE, entryTypeBadgeSpec } from './entry-type-badge';

describe('ENTRY_TYPE_BADGE', () => {
  it('covers all four entry types with a distinct tone', () => {
    const types = ['receipt', 'issue', 'transfer', 'adjustment'] as const;
    expect(Object.keys(ENTRY_TYPE_BADGE).sort()).toEqual([...types].sort());
    const tones = types.map((t) => ENTRY_TYPE_BADGE[t].value);
    expect(new Set(tones).size).toBe(4);
  });

  it('assigns a distinct icon per type', () => {
    const types = ['receipt', 'issue', 'transfer', 'adjustment'] as const;
    const icons = types.map((t) => ENTRY_TYPE_BADGE[t].icon);
    expect(new Set(icons).size).toBe(4);
  });

  it('maps receipt/issue/transfer/adjustment to success/error/info/warning', () => {
    expect(ENTRY_TYPE_BADGE.receipt.value).toBe('success');
    expect(ENTRY_TYPE_BADGE.issue.value).toBe('error');
    expect(ENTRY_TYPE_BADGE.transfer.value).toBe('info');
    expect(ENTRY_TYPE_BADGE.adjustment.value).toBe('warning');
  });
});

describe('entryTypeBadgeSpec', () => {
  it('returns undefined for an unknown/legacy type', () => {
    expect(entryTypeBadgeSpec('bogus')).toBeUndefined();
  });

  it('returns the mapped spec for a known type', () => {
    expect(entryTypeBadgeSpec('receipt')?.value).toBe('success');
  });
});
