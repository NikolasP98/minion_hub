import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (_ctx: unknown, fn: (tx: { execute: typeof mocks.execute }) => unknown) =>
    fn({ execute: mocks.execute }),
}));

import { CrmTagBulkStorageError, mutateCrmContactTagsBulk } from './crm-contact-tags-bulk.service';

const add = {
  targetId: '00000000-0000-4000-8000-000000000001',
  tagId: '00000000-0000-4000-8000-000000000002',
  action: 'add' as const,
};
const remove = {
  targetId: '00000000-0000-4000-8000-000000000003',
  tagId: '00000000-0000-4000-8000-000000000004',
  action: 'remove' as const,
};

describe('mutateCrmContactTagsBulk', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses one JSONB payload statement with a constant two-bind ceiling', async () => {
    mocks.execute.mockResolvedValue([
      {
        ord: 0,
        target_id: add.targetId,
        tag_id: add.tagId,
        action: 'add',
        is_valid: true,
        changed_rows: 1,
      },
      {
        ord: 1,
        target_id: remove.targetId,
        tag_id: remove.tagId,
        action: 'remove',
        is_valid: false,
        changed_rows: 1,
      },
    ]);

    const result = await mutateCrmContactTagsBulk(
      { tenantId: 'org-1' } as never,
      [add, remove],
      null,
    );
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0]![0]);
    expect(query.params).toHaveLength(2);
    expect(query.sql).toContain('jsonb_to_recordset($1::jsonb)');
    expect(query.sql).toContain('insert into crm_contact_tags');
    expect(query.sql).toContain('delete from crm_contact_tags');
    expect(query.sql).not.toContain('values (');
    expect(result).toEqual({
      results: [
        { operation: add, disposition: 'completed' },
        { operation: remove, disposition: 'pending', errorCode: 'invalid_operation' },
      ],
      changedRows: 1,
    });
  });

  it('keeps the same statement and bind counts at the 2,000-operation bound', async () => {
    mocks.execute.mockResolvedValue([]);
    const operations = Array.from({ length: 2_000 }, (_, index) => ({
      ...add,
      targetId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    }));
    await mutateCrmContactTagsBulk({ tenantId: 'org-1' } as never, operations, null);
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0]![0]);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(query.params).toHaveLength(2);
    expect(String(query.params[0])).toContain('"ord":1999');
  });

  it('marks only an in-transaction statement failure as known rolled-back storage failure', async () => {
    mocks.execute.mockRejectedValue(new Error('private driver detail'));
    await expect(
      mutateCrmContactTagsBulk({ tenantId: 'org-1' } as never, [add], null),
    ).rejects.toBeInstanceOf(CrmTagBulkStorageError);
  });
});
