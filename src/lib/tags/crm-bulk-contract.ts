/** Shared wire contract. No server imports: the client validates acknowledgements before retiring intent. */
export const CRM_TAG_BULK_MAX_OPERATIONS = 2_000;
export const CRM_TAG_BULK_MAX_BYTES = 512 * 1024;
export const CRM_TAG_BULK_CONCURRENCY = 2;

export type CrmTagBulkOperation = {
  targetId: string;
  tagId: string;
  action: 'add' | 'remove';
};
export type CrmTagBulkResult = {
  operationKey: string;
  operation: CrmTagBulkOperation;
} & (
  | { disposition: 'completed' }
  | { disposition: 'pending'; errorCode: 'invalid_operation' | 'storage_failure' }
);
export type CrmTagBulkResponse = {
  version: 1;
  results: CrmTagBulkResult[];
  cacheInvalidation: 'not_needed' | 'ok' | 'failed';
};
export type CrmTagBulkErrorCode =
  | 'unauthenticated'
  | 'module_disabled'
  | 'forbidden'
  | 'invalid_request'
  | 'payload_too_large'
  | 'storage_failure';

export const CRM_TAG_BULK_ERROR_STATUS: Record<CrmTagBulkErrorCode, number> = {
  unauthenticated: 401,
  module_disabled: 404,
  forbidden: 403,
  invalid_request: 400,
  payload_too_large: 413,
  storage_failure: 500,
};

export function crmTagOperationKey(operation: CrmTagBulkOperation): string {
  return `${operation.action}:${operation.targetId}:${operation.tagId}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Normalize identity before deduplication; contradictory intent never reaches transport. */
export function canonicalizeCrmTagOperations(
  operations: readonly CrmTagBulkOperation[],
): CrmTagBulkOperation[] {
  const pairs = new Map<string, CrmTagBulkOperation['action']>();
  const canonical: CrmTagBulkOperation[] = [];
  for (const operation of operations) {
    if (
      !UUID.test(operation.targetId) ||
      !UUID.test(operation.tagId) ||
      (operation.action !== 'add' && operation.action !== 'remove')
    ) {
      throw new Error('Invalid CRM tag operation');
    }
    const normalized = {
      targetId: operation.targetId.toLowerCase(),
      tagId: operation.tagId.toLowerCase(),
      action: operation.action,
    };
    const pair = `${normalized.targetId}:${normalized.tagId}`;
    const previous = pairs.get(pair);
    if (previous && previous !== normalized.action) {
      throw new Error('Contradictory CRM tag operations');
    }
    if (!previous) canonical.push(normalized);
    pairs.set(pair, normalized.action);
  }
  return canonical;
}
