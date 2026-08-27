import { describe, expect, it } from 'vitest';
import { crmCountScopeFingerprint } from './customer-query';

describe('crmCountScopeFingerprint', () => {
  it('reuses a count across sorting and pagination changes', () => {
    const first = new URLSearchParams({
      search: 'ana',
      stage: 'Active',
      sort: 'score',
      sortDir: 'desc',
      limit: '100',
      offset: '0',
    });
    const reordered = new URLSearchParams({
      offset: '100',
      limit: '50',
      sortDir: 'asc',
      sort: 'name',
      stage: 'Active',
      search: 'ana',
      includeTotal: '0',
    });

    expect(crmCountScopeFingerprint(first)).toBe(crmCountScopeFingerprint(reordered));
  });

  it('requires a fresh count when a real filter changes', () => {
    const active = new URLSearchParams({ stage: 'Active', sort: 'score' });
    const dormant = new URLSearchParams({ stage: 'Dormant', sort: 'score' });

    expect(crmCountScopeFingerprint(active)).not.toBe(crmCountScopeFingerprint(dormant));
  });
});
