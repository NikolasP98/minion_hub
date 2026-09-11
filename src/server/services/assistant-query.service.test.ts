import { describe, test, expect, vi } from 'vitest';
import { runReadOnlyOrgQuery, QueryRejected } from './assistant-query.service';
import type { CoreCtx } from '$server/auth/core-ctx';

describe('raw assistant SQL containment', () => {
  test.each([
    'select 1',
    'WITH totals AS (SELECT count(*) FROM fin_invoices) SELECT * FROM totals',
    'select * from parties',
    'delete from fin_invoices',
    'select 1; select 2',
    '',
  ])('rejects every input without a transaction: %s', async (query) => {
    const transaction = vi.fn(() => {
      throw new Error('Database access is forbidden for the disabled SQL surface');
    });
    const ctx = { db: { transaction }, tenantId: 'org-1' } as unknown as CoreCtx;

    const rejection = runReadOnlyOrgQuery(ctx, query);
    await expect(rejection).rejects.toBeInstanceOf(QueryRejected);
    await expect(rejection).rejects.toMatchObject({
      code: 'ASSISTANT_SQL_DISABLED',
      status: 503,
      retryable: false,
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});
