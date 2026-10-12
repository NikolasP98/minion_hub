import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CRM_TAG_BULK_MAX_BYTES } from '$lib/tags/crm-bulk-contract';

const mocks = vi.hoisted(() => ({
  getCoreCtx: vi.fn(),
  isModuleEnabled: vi.fn(),
  requireOrgCapability: vi.fn(),
  mutate: vi.fn(),
  bustCrmList: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock('@sentry/sveltekit', () => ({ captureException: mocks.captureException }));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: mocks.getCoreCtx }));
vi.mock('$server/services/modules.service', () => ({ isModuleEnabled: mocks.isModuleEnabled }));
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: mocks.requireOrgCapability,
}));
vi.mock('$server/services/crm-contact-tags-bulk.service', () => ({
  CrmTagBulkStorageError: class CrmTagBulkStorageError extends Error {},
  mutateCrmContactTagsBulk: mocks.mutate,
}));
vi.mock('$server/services/crm-contacts.service', () => ({ bustCrmList: mocks.bustCrmList }));

import { POST } from './+server';
import { PayloadTooLargeError, readBoundedJson } from './request-body';
import { CrmTagBulkStorageError } from '$server/services/crm-contact-tags-bulk.service';

const upperOperation = {
  targetId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
  tagId: 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB',
  action: 'add' as const,
};

function request(body: unknown, headers?: HeadersInit) {
  return new Request('https://hub.test/api/crm/contacts/tags/bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function post(req = request({ operations: [upperOperation] })) {
  return POST({ locals: { user: { supabaseId: null } }, request: req } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCoreCtx.mockResolvedValue({ tenantId: 'org-1' });
  mocks.isModuleEnabled.mockResolvedValue(true);
  mocks.requireOrgCapability.mockResolvedValue(undefined);
  mocks.mutate.mockResolvedValue({
    results: [],
    changedRows: 0,
    statementCount: 1,
    maxBindCount: 2,
  });
  mocks.bustCrmList.mockResolvedValue(undefined);
});

describe('POST /api/crm/contacts/tags/bulk', () => {
  it('returns canonical authority errors before reading the body', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull: vi.fn(() => {
        throw new Error('body must not be read');
      }),
    });
    const req = new Request('https://hub.test/api/crm/contacts/tags/bulk', {
      method: 'POST',
      body,
      duplex: 'half',
    } as RequestInit);
    mocks.getCoreCtx.mockResolvedValue(null);
    let response = await post(req);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      version: 1,
      error: { code: 'unauthenticated' },
    });

    mocks.getCoreCtx.mockResolvedValue({ tenantId: 'org-1' });
    mocks.isModuleEnabled.mockResolvedValue(false);
    response = await post(req);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      version: 1,
      error: { code: 'module_disabled' },
    });

    mocks.isModuleEnabled.mockResolvedValue(true);
    mocks.requireOrgCapability.mockRejectedValue({ status: 403 });
    response = await post(req);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ version: 1, error: { code: 'forbidden' } });
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('rejects declared and streamed overflow and releases the owned reader', async () => {
    let response = await post(
      request(
        { operations: [upperOperation] },
        { 'content-length': String(CRM_TAG_BULK_MAX_BYTES + 1) },
      ),
    );
    expect(response.status).toBe(413);

    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(CRM_TAG_BULK_MAX_BYTES + 1));
      },
      cancel,
    });
    const streamed = new Request('https://hub.test/api/crm/contacts/tags/bulk', {
      method: 'POST',
      body,
      duplex: 'half',
    } as RequestInit);
    response = await post(streamed);
    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalledWith('payload_too_large');
    expect(streamed.body?.locked).toBe(false);
  });

  it('rejects malformed and contradictory requests without a service call', async () => {
    let response = await post(request({ operations: [{ ...upperOperation, targetId: 'nope' }] }));
    expect(response.status).toBe(400);
    response = await post(
      request({ operations: [upperOperation, { ...upperOperation, action: 'remove' }] }),
    );
    expect(response.status).toBe(400);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('admits the measured 2,000-operation fixture below the byte ceiling', async () => {
    const operations = Array.from({ length: 2_000 }, (_, index) => ({
      targetId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      tagId: '00000000-0000-4000-8000-999999999999',
      action: 'add' as const,
    }));
    const encoded = JSON.stringify({ operations });
    expect(new TextEncoder().encode(encoded).byteLength).toBeLessThanOrEqual(
      CRM_TAG_BULK_MAX_BYTES,
    );
    const response = await post(request({ operations }));
    expect(response.status).toBe(200);
    expect(mocks.mutate.mock.calls[0]![1]).toHaveLength(2_000);
  });

  it('lowercases and deduplicates before one service call, preserving the response partition', async () => {
    const operation = {
      targetId: upperOperation.targetId.toLowerCase(),
      tagId: upperOperation.tagId.toLowerCase(),
      action: 'add' as const,
    };
    mocks.mutate.mockResolvedValue({
      results: [{ operation, disposition: 'completed' }],
      changedRows: 1,
      statementCount: 1,
      maxBindCount: 2,
    });
    const response = await post(request({ operations: [upperOperation, upperOperation] }));
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org-1' }),
      [operation],
      null,
    );
    expect(mocks.bustCrmList).toHaveBeenCalledWith('org-1');
    await expect(response.json()).resolves.toEqual({
      version: 1,
      results: [
        {
          operationKey: `add:${operation.targetId}:${operation.tagId}`,
          operation,
          disposition: 'completed',
        },
      ],
      cacheInvalidation: 'ok',
    });
  });

  it('preserves committed dispositions when cache invalidation fails', async () => {
    const operation = {
      ...upperOperation,
      targetId: upperOperation.targetId.toLowerCase(),
      tagId: upperOperation.tagId.toLowerCase(),
    };
    mocks.mutate.mockResolvedValue({
      results: [{ operation, disposition: 'completed' }],
      changedRows: 1,
      statementCount: 1,
      maxBindCount: 2,
    });
    mocks.bustCrmList.mockRejectedValue(new Error('cache unavailable'));
    const response = await post();
    expect(response.status).toBe(200);
    expect((await response.json()).cacheInvalidation).toBe('failed');
    expect(mocks.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { operation: 'crm.contact_tags.bulk', phase: 'invalidation' },
    });
  });

  it('preserves committed and sanitized responses when telemetry throws', async () => {
    const operation = {
      ...upperOperation,
      targetId: upperOperation.targetId.toLowerCase(),
      tagId: upperOperation.tagId.toLowerCase(),
    };
    mocks.captureException.mockImplementation(() => {
      throw new Error('telemetry unavailable');
    });
    mocks.mutate.mockResolvedValue({
      results: [{ operation, disposition: 'completed' }],
      changedRows: 1,
    });
    mocks.bustCrmList.mockRejectedValue(new Error('cache unavailable'));
    let response = await post();
    expect(response.status).toBe(200);
    expect((await response.json()).cacheInvalidation).toBe('failed');

    mocks.mutate.mockRejectedValue(new CrmTagBulkStorageError());
    response = await post();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      version: 1,
      error: { code: 'storage_failure' },
    });
  });

  it('returns sanitized storage failure without invalidating', async () => {
    mocks.mutate.mockRejectedValue(new CrmTagBulkStorageError());
    const response = await post();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      version: 1,
      error: { code: 'storage_failure' },
    });
    expect(mocks.bustCrmList).not.toHaveBeenCalled();
    expect(mocks.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { operation: 'crm.contact_tags.bulk', phase: 'mutation' },
    });
  });

  it('uses a non-contract response for transaction-wrapper or commit acknowledgement failure', async () => {
    mocks.mutate.mockRejectedValue(new Error('commit acknowledgement unavailable'));
    const response = await post();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      version: 1,
      error: { code: 'commit_unknown' },
    });
  });
});

describe('readBoundedJson', () => {
  it('parses an undeclared streamed body within the ceiling', async () => {
    const encoded = new TextEncoder().encode('{"operations":[]}');
    const req = new Request('https://hub.test', {
      method: 'POST',
      body: new ReadableStream({
        start: (controller) => {
          controller.enqueue(encoded);
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit);
    await expect(readBoundedJson(req)).resolves.toEqual({ operations: [] });
    expect(req.body?.locked).toBe(false);
  });

  it('preserves payload-too-large when producer cancellation rejects', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(CRM_TAG_BULK_MAX_BYTES + 1));
      },
      cancel() {
        throw new Error('producer cancellation failed');
      },
    });
    const req = new Request('https://hub.test', {
      method: 'POST',
      body,
      duplex: 'half',
    } as RequestInit);
    await expect(readBoundedJson(req)).rejects.toBeInstanceOf(PayloadTooLargeError);
    expect(req.body?.locked).toBe(false);
  });
});
