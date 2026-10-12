import { sql } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { withOrgCore } from '$server/db/with-org-core';
import type { CrmTagBulkOperation } from '$lib/tags/crm-bulk-contract';

export interface CrmContactTagBulkResult {
  operation: CrmTagBulkOperation;
  disposition: 'completed' | 'pending';
  errorCode?: 'invalid_operation';
}

export interface CrmContactTagBulkMutation {
  results: CrmContactTagBulkResult[];
  changedRows: number;
}

/** A statement failure inside the open transaction; withOrgCore rolls this back. */
export class CrmTagBulkStorageError extends Error {
  readonly sqlState?: string;

  constructor(sqlState?: string) {
    super('CRM contact tag bulk statement failed');
    this.name = 'CrmTagBulkStorageError';
    this.sqlState = sqlState;
  }
}

interface MutationRow extends Record<string, unknown> {
  ord: number;
  target_id: string;
  tag_id: string;
  action: 'add' | 'remove';
  is_valid: boolean;
  changed_rows: number;
}

/**
 * Apply one canonical CRM tag chunk in a single data-modifying statement.
 * Validation, writes, and dispositions therefore share one transaction snapshot.
 */
export async function mutateCrmContactTagsBulk(
  ctx: CoreCtx,
  operations: readonly CrmTagBulkOperation[],
  appliedBy: string | null,
): Promise<CrmContactTagBulkMutation> {
  const payload = operations.map((operation, ord) => ({
    ord,
    target_id: operation.targetId,
    tag_id: operation.tagId,
    action: operation.action,
  }));

  const rows = await withOrgCore(ctx, async (tx) => {
    try {
      return await tx.execute<MutationRow>(sql`
      with input as materialized (
        select ord, target_id, tag_id, action
        from jsonb_to_recordset(${JSON.stringify(payload)}::jsonb)
          as operation(ord integer, target_id uuid, tag_id uuid, action text)
      ),
      valid as materialized (
        select operation.*
        from input operation
        join crm_contacts contact
          on contact.id = operation.target_id
         and contact.org_id = current_setting('app.current_org_id', true)
         and contact.deleted_at is null
        join crm_tags tag
          on tag.id = operation.tag_id
         and tag.org_id = current_setting('app.current_org_id', true)
         and tag.scope = 'crm'
         and tag.kind = 'manual'
      ),
      inserted as (
        insert into crm_contact_tags (org_id, contact_id, tag_id, applied_by)
        select current_setting('app.current_org_id', true), target_id, tag_id, ${appliedBy}::uuid
        from valid
        where action = 'add'
        on conflict (contact_id, tag_id) do nothing
        returning 1
      ),
      deleted as (
        delete from crm_contact_tags link
        using valid
        where valid.action = 'remove'
          and link.org_id = current_setting('app.current_org_id', true)
          and link.contact_id = valid.target_id
          and link.tag_id = valid.tag_id
        returning 1
      )
      select input.ord,
             input.target_id::text as target_id,
             input.tag_id::text as tag_id,
             input.action,
             exists (select 1 from valid where valid.ord = input.ord) as is_valid,
             ((select count(*) from inserted) + (select count(*) from deleted))::integer as changed_rows
      from input
      order by input.ord
      `);
    } catch (cause) {
      // The callback rejects while the transaction is still open, so the
      // wrapper rolls it back. Do not expose the driver error or SQL.
      const driver = cause as { code?: string; cause?: { code?: string } };
      throw new CrmTagBulkStorageError(driver.code ?? driver.cause?.code);
    }
  });

  const changedRows = rows[0]?.changed_rows ?? 0;
  return {
    results: rows.map((row) => ({
      operation: { targetId: row.target_id, tagId: row.tag_id, action: row.action },
      disposition: row.is_valid ? 'completed' : 'pending',
      ...(row.is_valid ? {} : { errorCode: 'invalid_operation' as const }),
    })),
    changedRows,
  };
}
