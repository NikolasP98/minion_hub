import {
  canonicalizeCrmTagOperations,
  crmTagOperationKey,
  CRM_TAG_BULK_CONCURRENCY,
  CRM_TAG_BULK_ERROR_STATUS,
  CRM_TAG_BULK_MAX_OPERATIONS,
  type CrmTagBulkErrorCode,
  type CrmTagBulkOperation,
  type CrmTagBulkResponse,
} from '$lib/tags/crm-bulk-contract';
import type { TagBulkOutcome } from './tag-bulk';
import { reportCrmTagBulkFailure } from './crm-tag-bulk-monitor';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}

/** Admit the complete exact partition before exposing any completed operation. */
function validResponse(
  value: unknown,
  operations: CrmTagBulkOperation[],
): value is CrmTagBulkResponse {
  if (
    !record(value) ||
    !exactKeys(value, ['version', 'results', 'cacheInvalidation']) ||
    value.version !== 1 ||
    !Array.isArray(value.results) ||
    value.results.length !== operations.length ||
    typeof value.cacheInvalidation !== 'string' ||
    !['not_needed', 'ok', 'failed'].includes(value.cacheInvalidation)
  )
    return false;
  return value.results.every((result: unknown, index: number) => {
    const expected = operations[index]!;
    if (
      !record(result) ||
      !record(result.operation) ||
      !exactKeys(result.operation, ['targetId', 'tagId', 'action']) ||
      !exactKeys(
        result,
        result.disposition === 'pending'
          ? ['operationKey', 'operation', 'disposition', 'errorCode']
          : ['operationKey', 'operation', 'disposition'],
      )
    )
      return false;
    return (
      result.operationKey === crmTagOperationKey(expected) &&
      result.operation.targetId === expected.targetId &&
      result.operation.tagId === expected.tagId &&
      result.operation.action === expected.action &&
      ((result.disposition === 'completed' && result.errorCode === undefined) ||
        (result.disposition === 'pending' &&
          (result.errorCode === 'invalid_operation' || result.errorCode === 'storage_failure')))
    );
  });
}

function knownFailure(value: unknown, status: number): boolean {
  if (
    !record(value) ||
    !exactKeys(value, ['version', 'error']) ||
    value.version !== 1 ||
    !record(value.error) ||
    !exactKeys(value.error, ['code'])
  )
    return false;
  const code = value.error.code;
  return (
    typeof code === 'string' &&
    Object.hasOwn(CRM_TAG_BULK_ERROR_STATUS, code) &&
    CRM_TAG_BULK_ERROR_STATUS[code as CrmTagBulkErrorCode] === status
  );
}

type ChunkOutcome = {
  completed: CrmTagBulkOperation[];
  pending: CrmTagBulkOperation[];
  unknown: boolean;
  error?: Error;
  refreshFailed?: boolean;
};

async function sendChunk(operations: CrmTagBulkOperation[]): Promise<ChunkOutcome> {
  // No request retries here: an absent/invalid acknowledgement cannot prove a rollback.
  try {
    const response = await fetch('/api/crm/contacts/tags/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operations }),
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      return {
        completed: [],
        pending: operations,
        unknown: !knownFailure(body, response.status),
        error: new Error('CRM tag request was not acknowledged'),
      };
    }
    if (!validResponse(body, operations)) {
      return {
        completed: [],
        pending: operations,
        unknown: true,
        error: new Error('Invalid CRM tag acknowledgement'),
      };
    }
    const completed: CrmTagBulkOperation[] = [];
    const pending: CrmTagBulkOperation[] = [];
    for (const [index, result] of body.results.entries()) {
      (result.disposition === 'completed' ? completed : pending).push(operations[index]!);
    }
    return {
      completed,
      pending,
      unknown: false,
      ...(pending.length ? { error: new Error('Some CRM tag operations were rejected') } : {}),
      refreshFailed: body.cacheInvalidation === 'failed',
    };
  } catch {
    // Deliberately omit raw transport errors and response bodies from user/telemetry state.
    return {
      completed: [],
      pending: operations,
      unknown: true,
      error: new Error('CRM tag result is unknown'),
    };
  }
}

/** Two bounded requests in flight; merge in plan order even when responses arrive out of order. */
export async function sendCrmTagBulk(operations: CrmTagBulkOperation[]): Promise<TagBulkOutcome> {
  let canonical: CrmTagBulkOperation[];
  try {
    canonical = canonicalizeCrmTagOperations(operations);
  } catch {
    reportCrmTagBulkFailure('failed');
    return {
      status: 'failed',
      completed: [],
      pending: operations,
      error: new Error('Invalid CRM tag plan'),
    };
  }
  const chunks: CrmTagBulkOperation[][] = [];
  for (let offset = 0; offset < canonical.length; offset += CRM_TAG_BULK_MAX_OPERATIONS) {
    chunks.push(canonical.slice(offset, offset + CRM_TAG_BULK_MAX_OPERATIONS));
  }
  const results = new Array<ChunkOutcome>(chunks.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < chunks.length) {
      const index = cursor++;
      results[index] = await sendChunk(chunks[index]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CRM_TAG_BULK_CONCURRENCY, chunks.length) }, worker),
  );
  const completed = results.flatMap((result) => result.completed);
  const pending = results.flatMap((result) => result.pending);
  const warning = results.some((result) => result.refreshFailed)
    ? { code: 'committed-refresh-failed' as const }
    : undefined;
  if (warning) reportCrmTagBulkFailure('committed-refresh-failed');
  if (!pending.length)
    return { status: 'succeeded', completed, pending: [], ...(warning ? { warning } : {}) };
  const status = completed.length
    ? 'partial'
    : results.some((result) => result.unknown)
      ? 'unknown'
      : 'failed';
  reportCrmTagBulkFailure(status);
  return {
    status,
    completed,
    pending,
    error: results.find((result) => result.error)?.error,
    ...(warning ? { warning } : {}),
  };
}
