import { describe, it, expect } from 'vitest';
import { ENTRY_TYPES } from '$lib/stock/entry-legs';
import { ENTRY_TYPE_BADGE, entryTypeBadgeSpec } from './entry-type-badge';
import { entryTypeLabel } from './entry-type-label';

describe('ENTRY_TYPE_BADGE', () => {
  it('covers every entry type; the four classic types keep a distinct tone', () => {
    expect(Object.keys(ENTRY_TYPE_BADGE).sort()).toEqual([...ENTRY_TYPES].sort());
    const types = ['receipt', 'issue', 'transfer', 'adjustment'] as const;
    const tones = types.map((t) => ENTRY_TYPE_BADGE[t].value);
    expect(new Set(tones).size).toBe(4);
  });

  it('assigns a distinct icon per type', () => {
    const icons = ENTRY_TYPES.map((t) => ENTRY_TYPE_BADGE[t].icon);
    expect(new Set(icons).size).toBe(ENTRY_TYPES.length);
  });

  it('labels an exchange (canje) as info with its own two-way icon', () => {
    expect(ENTRY_TYPE_BADGE.exchange.value).toBe('info');
    expect(ENTRY_TYPE_BADGE.exchange.icon).not.toBe(ENTRY_TYPE_BADGE.transfer.icon);
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

describe('entryTypeLabel', () => {
  it('labels every entry type and returns null for an unknown one', () => {
    for (const t of ENTRY_TYPES) expect(entryTypeLabel(t)).toBeTruthy();
    expect(entryTypeLabel('exchange')).toMatch(/Canje|Exchange/);
    expect(entryTypeLabel('bogus')).toBeNull();
    expect(entryTypeLabel(undefined)).toBeNull();
  });
});
