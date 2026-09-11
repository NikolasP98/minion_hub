import { describe, expect, it, vi } from 'vitest';
vi.mock('$server/ai-usage', () => ({ recordAiUsage: vi.fn() }));
vi.mock('$env/dynamic/private', () => ({ env: { OPENROUTER_API_KEY: 'synthetic' } }));
import {
  readJobRequest,
  withJobRequest,
  runJobEmbedding,
  createJobRequest,
  bindJobManifest,
} from './job-effects.service';
import type { JobExecution, BgJob } from './bg-runtime';
import type { OrgScope } from '$server/db/with-org-core';

const request = {
  family: 'brain',
  entityId: 'doc',
  revision: '10000000-0000-4000-8000-000000000001',
  sourceHash: 'a'.repeat(64),
};
describe('job effects input boundaries', () => {
  it('rejects malformed and incomplete embedding contracts before ownership', async () => {
    const withOwnership = vi.fn();
    const execution = {
      tenantId: 'a',
      withOwnership,
      signal: new AbortController().signal,
    } as unknown as JobExecution;
    for (const options of [
      null,
      [],
      { expectedManifestHash: 'bad' },
      { expectedManifestHash: 'b'.repeat(64) },
      { expectedProvider: {} },
      { validateDomain: 'not-a-function' },
      {
        expectedManifestHash: 'b'.repeat(64),
        expectedProvider: {
          endpoint: 'x',
          model: 'y',
          normalization: 'v',
          dimensions: 3,
        },
      },
    ]) {
      await expect(
        runJobEmbedding(
          execution,
          { tenantId: 'a' } as OrgScope,
          request,
          'batch',
          ['x'],
          'v1',
          options as never,
        ),
      ).rejects.toMatchObject({ code: 'conflict' });
    }
    expect(withOwnership).not.toHaveBeenCalled();
  });
  it('rejects invalid manifest or guard before opening an owned transaction', async () => {
    const withOwnership = vi.fn();
    const execution = {
      tenantId: 'a',
      withOwnership,
      signal: new AbortController().signal,
    } as unknown as JobExecution;
    await expect(
      withJobRequest(
        execution,
        { tenantId: 'a' } as OrgScope,
        request,
        async () => 1,
        undefined,
        'bad',
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      bindJobManifest(
        execution,
        { tenantId: 'a' } as OrgScope,
        request,
        'b'.repeat(64),
        undefined as never,
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(withOwnership).not.toHaveBeenCalled();
  });
  it('rejects a changed actual provider before ownership admission', async () => {
    const withOwnership = vi.fn();
    const execution = {
      tenantId: 'a',
      withOwnership,
      signal: new AbortController().signal,
    } as unknown as JobExecution;
    await expect(
      runJobEmbedding(execution, { tenantId: 'a' } as OrgScope, request, 'batch', ['x'], 'v1', {
        expectedManifestHash: 'b'.repeat(64),
        expectedProvider: {
          endpoint: 'https://api.openai.com/v1/embeddings',
          model: 'text-embedding-3-small',
          normalization: 'embedding-text-v1',
          dimensions: 1536,
        },
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(withOwnership).not.toHaveBeenCalled();
  });
  it('preserves a well-formed durable request and rejects malformed persisted cursors', () => {
    expect(
      readJobRequest({ cursor: JSON.stringify({ __jobRequest: request, next: 2 }) } as BgJob),
    ).toEqual(request);
    for (const cursor of [
      'null',
      '[]',
      '{',
      JSON.stringify({ __jobRequest: { ...request, revision: 'caller' } }),
    ])
      expect(() => readJobRequest({ cursor } as BgJob)).toThrow();
    expect(readJobRequest({ cursor: null } as BgJob)).toBeNull();
  });

  it('rejects tenant mismatch before ownership or domain work', async () => {
    const withOwnership = vi.fn();
    const execution = {
      tenantId: 'a',
      withOwnership,
      signal: new AbortController().signal,
    } as unknown as JobExecution;
    await expect(
      withJobRequest(execution, { tenantId: 'b' } as OrgScope, request, async () => 1),
    ).rejects.toThrow(/tenant/);
    expect(withOwnership).not.toHaveBeenCalled();
  });

  it('rejects unbounded and sparse job batches before admission', async () => {
    const withOwnership = vi.fn();
    const execution = {
      tenantId: 'a',
      withOwnership,
      signal: new AbortController().signal,
    } as unknown as JobExecution;
    for (const texts of [[], Array(65).fill('x'), new Array<string>(2)]) {
      await expect(
        runJobEmbedding(execution, { tenantId: 'a' } as OrgScope, request, 'batch', texts, 'v1'),
      ).rejects.toThrow(/batch|inputs/);
    }
    expect(withOwnership).not.toHaveBeenCalled();
  });

  it('rejects invalid request identity without opening a transaction', async () => {
    const transaction = vi.fn();
    const scope = { tenantId: 'org', db: { transaction } } as unknown as OrgScope;
    await expect(
      createJobRequest(
        scope,
        { family: '', entityId: 'doc' },
        'a'.repeat(64),
        { type: 'brain_ingest' },
        async () => null,
      ),
    ).rejects.toThrow(/identity/);
    expect(transaction).not.toHaveBeenCalled();
  });
});
