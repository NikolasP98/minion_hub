import { json } from '@sveltejs/kit';
import * as Sentry from '@sentry/sveltekit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import { bustCrmList } from '$server/services/crm-contacts.service';
import {
  CrmTagBulkStorageError,
  mutateCrmContactTagsBulk,
} from '$server/services/crm-contact-tags-bulk.service';
import {
  CRM_TAG_BULK_ERROR_STATUS,
  CRM_TAG_BULK_MAX_OPERATIONS,
  canonicalizeCrmTagOperations,
  crmTagOperationKey,
  type CrmTagBulkErrorCode,
  type CrmTagBulkResponse,
} from '$lib/tags/crm-bulk-contract';
import { PayloadTooLargeError, readBoundedJson } from './request-body';

const requestSchema = z
  .object({
    operations: z
      .array(
        z
          .object({
            targetId: z.string().max(100),
            tagId: z.string().max(100),
            action: z.enum(['add', 'remove']),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

function errorResponse(code: CrmTagBulkErrorCode) {
  return json({ version: 1, error: { code } }, { status: CRM_TAG_BULK_ERROR_STATUS[code] });
}

function commitUnknownResponse() {
  // Deliberately outside the documented error-code/status map: the client
  // treats a transaction-wrapper/COMMIT acknowledgement failure as unknown.
  return json({ version: 1, error: { code: 'commit_unknown' } }, { status: 503 });
}

function reportFailure(phase: 'auth' | 'module' | 'capability' | 'mutation' | 'invalidation') {
  // Fixed error and bounded phase only: never attach the request, ids, SQL, or underlying exception.
  try {
    Sentry.captureException(new Error('CRM contact tag bulk unavailable'), {
      tags: { operation: 'crm.contact_tags.bulk', phase },
    });
  } catch {
    // Telemetry is best-effort. It must never replace the sanitized protocol
    // response, especially after the database mutation has committed.
  }
}

export const POST: RequestHandler = async ({ locals, request }) => {
  let ctx;
  try {
    ctx = await getCoreCtx(locals);
  } catch {
    reportFailure('auth');
    return errorResponse('unauthenticated');
  }
  if (!ctx) return errorResponse('unauthenticated');

  try {
    if (!(await isModuleEnabled(ctx, 'crm'))) return errorResponse('module_disabled');
  } catch {
    reportFailure('module');
    return errorResponse('storage_failure');
  }
  try {
    await requireOrgCapability(locals, 'crm', 'edit');
  } catch (cause) {
    const status =
      typeof cause === 'object' && cause !== null && 'status' in cause
        ? Number(cause.status)
        : undefined;
    if (status === 401) return errorResponse('unauthenticated');
    if (status === 403 || status === 404) {
      return errorResponse('forbidden');
    }
    reportFailure('capability');
    return errorResponse('storage_failure');
  }

  let canonical;
  try {
    const parsed = requestSchema.parse(await readBoundedJson(request));
    canonical = canonicalizeCrmTagOperations(parsed.operations);
    if (canonical.length > CRM_TAG_BULK_MAX_OPERATIONS) return errorResponse('invalid_request');
  } catch (cause) {
    return errorResponse(
      cause instanceof PayloadTooLargeError ? 'payload_too_large' : 'invalid_request',
    );
  }

  let mutation;
  try {
    mutation = await mutateCrmContactTagsBulk(ctx, canonical, locals.user?.supabaseId ?? null);
  } catch (cause) {
    reportFailure('mutation');
    return cause instanceof CrmTagBulkStorageError
      ? errorResponse('storage_failure')
      : commitUnknownResponse();
  }

  let cacheInvalidation: CrmTagBulkResponse['cacheInvalidation'] = 'not_needed';
  if (mutation.changedRows > 0) {
    try {
      await bustCrmList(ctx.tenantId);
      cacheInvalidation = 'ok';
    } catch {
      reportFailure('invalidation');
      cacheInvalidation = 'failed';
    }
  }
  const response: CrmTagBulkResponse = {
    version: 1,
    results: mutation.results.map((result) => ({
      operationKey: crmTagOperationKey(result.operation),
      operation: result.operation,
      disposition: result.disposition,
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    })) as CrmTagBulkResponse['results'],
    cacheInvalidation,
  };
  return json(response);
};
