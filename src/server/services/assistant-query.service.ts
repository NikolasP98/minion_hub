import type { CoreCtx } from '$server/auth/core-ctx';

/** Stable response for the retired caller-authored SQL surface. */
export const ASSISTANT_SQL_DISABLED = {
  code: 'ASSISTANT_SQL_DISABLED',
  error: 'Arbitrary SQL analytics is unavailable. Use a supported typed query.',
  retryable: false,
} as const;

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
}

/** Kept for service callers while the raw SQL contract is retired. */
export class QueryRejected extends Error {
  readonly code = ASSISTANT_SQL_DISABLED.code;
  readonly status = 503;
  readonly retryable = false;

  constructor() {
    super(ASSISTANT_SQL_DISABLED.error);
    this.name = 'QueryRejected';
  }
}

/**
 * Caller-authored SQL is disabled for every principal. A transaction-local
 * role and a mutable tenant GUC do not isolate SQL controlled by that caller.
 * Preserve the signature so an indirect legacy caller also fails closed,
 * without opening a transaction or inspecting the submitted SQL.
 */
export async function runReadOnlyOrgQuery(_ctx: CoreCtx, _rawSql: string): Promise<QueryResult> {
  // TODO(handoff): Restore flexible analytics through tenant/module/owner/field-bound typed datasets and retire gateway crm_query advertisement. See meta proposals/2026-09-09-assistant-query-delegation-restoration.md (SEC-06 / Phase 15).
  throw new QueryRejected();
}
