import { describe, expect, it, vi } from 'vitest';
import type { JobExecution } from './bg-runtime';
import type { OrgScope } from '$server/db/with-org-core';
vi.mock('$server/db/pg-pool', () => ({
  getPgClient: vi.fn(),
  getRlsPgClient: vi.fn(),
  getCriticalPgClient: vi.fn(),
}));
vi.mock('$env/dynamic/private', () => ({ env: { OPENROUTER_API_KEY: 'synthetic-page-fixture' } }));
vi.mock('$server/ai-usage', () => ({ recordAiUsage: vi.fn() }));
import { bindJobEffectPage, type PageInput } from './job-effect-pages.service';

const input = (): PageInput => ({
  pageKey: 'page-1',
  pipelineVersion: 'fixture-v1',
  mode: 'embedded',
  servingGeneration: null,
  expectedProvider: {
    endpoint: 'https://openrouter.ai/api/v1/embeddings',
    model: 'openai/text-embedding-3-small',
    normalization: 'embedding-text-v1',
    dimensions: 1536,
  },
  sources: [
    {
      family: 'fixture.document',
      entityId: 'A',
      sourceHash: 'a'.repeat(64),
      chunks: [{ key: 'one', text: 'complete source text' }],
      requiredChunkKeys: ['one'],
    },
  ],
});
function forbiddenDatabase() {
  const withOwnership = vi.fn(async () => {
    throw new Error('unexpected database access');
  });
  const execution: JobExecution = {
    jobId: 'job-a',
    tenantId: 'org-a',
    leaseGeneration: 1,
    signal: new AbortController().signal,
    effectKey: () => 'unused',
    withOwnership,
  };
  // Validation must finish before the transaction handle is consulted.
  const scope = { tenantId: 'org-a', db: Object.freeze({}) } as OrgScope;
  return { execution, scope, withOwnership };
}
describe('page admission rejects invalid complete source before database work', () => {
  it.each(['disabled', 'qdrant'] as const)('rejects provider metadata in %s mode', async (mode) => {
    const value = input();
    value.mode = mode;
    const boundary = forbiddenDatabase();
    await expect(
      bindJobEffectPage(boundary.execution, boundary.scope, value, async () => {}),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(boundary.withOwnership).not.toHaveBeenCalled();
  });
  it('counts unchanged canonical chunks toward the complete-unit limit', async () => {
    const value = input();
    value.sources[0]!.requiredChunkKeys = [];
    value.sources[0]!.chunks = Array.from({ length: 257 }, (_, i) => ({
      key: String(i),
      text: '',
    }));
    const boundary = forbiddenDatabase();
    await expect(
      bindJobEffectPage(boundary.execution, boundary.scope, value, async () => {}),
    ).rejects.toMatchObject({ code: 'capacity' });
    expect(boundary.withOwnership).not.toHaveBeenCalled();
  });
  it.each([64, 65])(
    'enforces complete source cardinality at %i heads before ownership',
    async (count) => {
      const value = input();
      value.mode = 'disabled';
      value.expectedProvider = null;
      value.sources = Array.from({ length: count }, (_, index) => ({
        ...value.sources[0]!,
        entityId: String(index),
        chunks: [],
        requiredChunkKeys: [],
      }));
      const boundary = forbiddenDatabase();
      const attempt = bindJobEffectPage(boundary.execution, boundary.scope, value, async () => {});
      if (count === 64) {
        await expect(attempt).rejects.toThrow('unexpected database access');
        expect(boundary.withOwnership).toHaveBeenCalledTimes(1);
      } else {
        await expect(attempt).rejects.toMatchObject({ code: 'capacity' });
        expect(boundary.withOwnership).not.toHaveBeenCalled();
      }
    },
  );
  it('accepts 256 unchanged canonical units through validation without pretending persistence passed', async () => {
    const value = input();
    value.mode = 'disabled';
    value.expectedProvider = null;
    value.sources[0]!.requiredChunkKeys = [];
    value.sources[0]!.chunks = Array.from({ length: 256 }, (_, i) => ({
      key: String(i),
      text: '',
    }));
    const boundary = forbiddenDatabase();
    await expect(
      bindJobEffectPage(boundary.execution, boundary.scope, value, async () => {}),
    ).rejects.toThrow('unexpected database access');
    expect(boundary.withOwnership).toHaveBeenCalledTimes(1);
  });
  it.each(['界', 'a', '\ud800'])(
    'counts exact full UTF16 capacity for ASCII, Unicode and lone-surrogate sources',
    async (character) => {
      const value = input();
      value.mode = 'disabled';
      value.expectedProvider = null;
      value.sources[0]!.requiredChunkKeys = [];
      value.sources[0]!.chunks[0]!.text = character.repeat(2_097_152);
      const boundary = forbiddenDatabase();
      await expect(
        bindJobEffectPage(boundary.execution, boundary.scope, value, async () => {}),
      ).rejects.toThrow('unexpected database access');
      expect(boundary.withOwnership).toHaveBeenCalledTimes(1);
      value.sources[0]!.chunks[0]!.text += 'a';
      const denied = forbiddenDatabase();
      await expect(
        bindJobEffectPage(denied.execution, denied.scope, value, async () => {}),
      ).rejects.toMatchObject({ code: 'capacity' });
      expect(denied.withOwnership).not.toHaveBeenCalled();
    },
  );
  it('rejects escaped descriptor expansion despite acceptable unit cardinality', async () => {
    const value = input();
    value.mode = 'disabled';
    value.expectedProvider = null;
    value.sources[0]!.chunks = Array.from({ length: 256 }, (_, i) => ({
      key: String(i).padStart(3, '0') + '\u0001'.repeat(157),
      text: '',
    }));
    value.sources[0]!.requiredChunkKeys = value.sources[0]!.chunks.map((chunk) => chunk.key);
    const boundary = forbiddenDatabase();
    await expect(
      bindJobEffectPage(boundary.execution, boundary.scope, value, async () => {}),
    ).rejects.toMatchObject({ code: 'capacity' });
    expect(boundary.withOwnership).not.toHaveBeenCalled();
  });
  it('rejects duplicate chunk identities instead of silently deduplicating', async () => {
    const value = input();
    value.sources[0]!.chunks.push({ key: 'one', text: 'different' });
    const boundary = forbiddenDatabase();
    await expect(
      bindJobEffectPage(boundary.execution, boundary.scope, value, async () => {}),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(boundary.withOwnership).not.toHaveBeenCalled();
  });
  it('counts full untruncated text before preparation', async () => {
    const value = input();
    value.sources[0]!.chunks[0]!.text = 'a'.repeat(2_097_153);
    const boundary = forbiddenDatabase();
    await expect(
      bindJobEffectPage(boundary.execution, boundary.scope, value, async () => {}),
    ).rejects.toMatchObject({ code: 'capacity' });
    expect(boundary.withOwnership).not.toHaveBeenCalled();
  });
});

import { withOwnedJobScope, jobEffectHeadId } from './job-effects.service';
import type { BgJob } from './bg-runtime';
import type { CoreTx } from '$server/db/with-org-core';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
function helperFixture(foreign: BgJob | undefined, lockFailure?: unknown) {
  const current: BgJob = {
    id: 'job-a',
    tenantId: 'org-a',
    userId: null,
    type: 'fixture',
    refId: null,
    status: 'running',
    cursor: '{"keep":"canonical"}',
    error: null,
    attempts: 1,
    leaseGeneration: 1,
    leaseUntil: Date.now() + 60_000,
    createdAt: 0,
    updatedAt: 0,
    startedAt: 0,
    finishedAt: null,
  };
  const events: string[] = [];
  const lock = vi.fn(async (_mode: string, options: unknown) => {
    events.push('foreign-lock');
    expect(options).toEqual({ noWait: true });
    if (lockFailure) throw lockFailure;
    return foreign ? [foreign] : [];
  });
  const dialect = new PgDialect();
  const execute = vi.fn(async (query: SQL) => {
    const statement = dialect.sqlToQuery(query);
    events.push(
      statement.sql.includes("current_setting('app.job_effect_job_id'")
        ? 'capture-actor'
        : statement.sql.includes("set_config('app.job_effect_job_id'")
          ? statement.params[0] === current.id
            ? 'set-actor'
            : 'restore-actor'
          : statement.sql.includes("current_setting('role')")
            ? 'capture-role'
            : statement.sql.includes("set_config('role', 'app_ledger'")
              ? 'scope-role'
              : 'restore-role',
    );
    return [
      {
        role: 'none',
        org: '',
        profile: '',
        timeout: '0',
        actor: 'prior-job',
        generation: '7',
        owners: '[]',
      },
    ];
  });
  const update = vi.fn(() => ({
    set: () => ({
      where: async () => {
        events.push('progress');
      },
    }),
  }));
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ for: lock }) }) }),
    execute,
    update,
  } as unknown as CoreTx;
  const execution: JobExecution = {
    jobId: current.id,
    tenantId: current.tenantId,
    leaseGeneration: 1,
    signal: new AbortController().signal,
    effectKey: () => 'unused',
    withOwnership: async (operation) => operation(tx, current),
  };
  const scope = { tenantId: current.tenantId, db: Object.freeze({}) } as OrgScope;
  return { current, execution, scope, events, lock, update, execute, dialect };
}
function foreignJob(overrides: Partial<BgJob> = {}): BgJob {
  return { ...helperFixture(undefined).current, id: 'job-b', ...overrides };
}
describe('bounded reservation-owner prelocks', () => {
  it('rejects a missing historical owner distinctly without domain entry', async () => {
    const f = helperFixture(undefined),
      operation = vi.fn();
    await expect(
      withOwnedJobScope(f.execution, f.scope, operation, {
        foreignReservationOwners: [{ jobId: 'job-b', reservationGeneration: 1 }],
      }),
    ).rejects.toMatchObject({ code: 'owner_missing' });
    expect(operation).not.toHaveBeenCalled();
    expect(f.events).toEqual(['foreign-lock']);
  });
  it('returns contention for a locked owner without entering scoped work', async () => {
    const f = helperFixture(undefined, { code: '55P03' }),
      operation = vi.fn();
    await expect(
      withOwnedJobScope(f.execution, f.scope, operation, {
        foreignReservationOwners: [{ jobId: 'job-b', reservationGeneration: 1 }],
      }),
    ).rejects.toMatchObject({ code: 'owner_busy' });
    expect(operation).not.toHaveBeenCalled();
  });
  it('rejects a still-current foreign generation even when duplicate references disagree', async () => {
    const f = helperFixture(foreignJob({ leaseGeneration: 2 })),
      operation = vi.fn();
    await expect(
      withOwnedJobScope(f.execution, f.scope, operation, {
        foreignReservationOwners: [
          { jobId: 'job-b', reservationGeneration: 1 },
          { jobId: 'job-b', reservationGeneration: 2 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'owner_busy' });
    expect(f.lock).toHaveBeenCalledTimes(1);
    expect(operation).not.toHaveBeenCalled();
  });
  it('permits an invalid old generation and restores scope before canonical progress', async () => {
    const f = helperFixture(foreignJob({ leaseGeneration: 2 }));
    const result = await withOwnedJobScope(
      f.execution,
      f.scope,
      async () => {
        f.events.push('domain');
        return { value: 'ok', nextProgress: { keep: 'canonical', page: 1 } };
      },
      { foreignReservationOwners: [{ jobId: 'job-b', reservationGeneration: 1 }] },
    );
    expect(result).toBe('ok');
    expect(f.events).toEqual([
      'foreign-lock',
      'capture-actor',
      'set-actor',
      'capture-role',
      'scope-role',
      'domain',
      'restore-role',
      'restore-actor',
      'progress',
    ]);
  });
  it('does not reacquire its already-owned job row', async () => {
    const f = helperFixture(undefined);
    await withOwnedJobScope(f.execution, f.scope, async () => ({ value: undefined }), {
      foreignReservationOwners: [{ jobId: 'job-a', reservationGeneration: 1 }],
    });
    expect(f.lock).not.toHaveBeenCalled();
  });
  it('rejects 257 references before entering ownership even when they duplicate', async () => {
    const f = helperFixture(undefined),
      ownership = vi.spyOn(f.execution, 'withOwnership');
    await expect(
      withOwnedJobScope(f.execution, f.scope, async () => ({ value: 1 }), {
        foreignReservationOwners: Array.from({ length: 257 }, () => ({
          jobId: 'job-b',
          reservationGeneration: 1,
        })),
      }),
    ).rejects.toMatchObject({ code: 'capacity' });
    expect(ownership).not.toHaveBeenCalled();
  });
  it('accounts the exact 128 KiB escaped Unicode manifest and rejects one additional byte before locking', async () => {
    const refs = Array.from({ length: 256 }, (_, index) => ({
      jobId: String(index).padStart(3, '0'),
      reservationGeneration: 1,
    }));
    let remaining = 131_072 - Buffer.byteLength(JSON.stringify(refs));
    for (const ref of refs) {
      while (ref.jobId.length < 256 && remaining > 0) {
        const character = remaining >= 6 ? '\u0001' : remaining >= 3 ? '界' : 'a';
        const increment = Buffer.byteLength(JSON.stringify(character)) - 2;
        ref.jobId += character;
        remaining -= increment;
      }
    }
    expect(remaining).toBe(0);
    expect(Buffer.byteLength(JSON.stringify(refs))).toBe(131_072);
    const f = helperFixture(foreignJob({ status: 'done' }));
    await withOwnedJobScope(f.execution, f.scope, async () => ({ value: 1 }), {
      foreignReservationOwners: refs,
    });
    const context = f.execute.mock.calls
      .map(([query]) => f.dialect.sqlToQuery(query))
      .find(
        (query) =>
          query.sql.includes("set_config('app.job_effect_job_id'") && query.params[0] === 'job-a',
      );
    expect(Buffer.byteLength(String(context?.params[2]))).toBe(131_072);
    const extra = refs.map((ref) => ({ ...ref }));
    extra[255].jobId += 'a';
    expect(Buffer.byteLength(JSON.stringify(extra))).toBe(131_073);
    const denied = helperFixture(undefined),
      ownership = vi.spyOn(denied.execution, 'withOwnership');
    await expect(
      withOwnedJobScope(denied.execution, denied.scope, async () => ({ value: 1 }), {
        foreignReservationOwners: extra,
      }),
    ).rejects.toMatchObject({ code: 'capacity' });
    expect(ownership).not.toHaveBeenCalled();
    expect(denied.lock).not.toHaveBeenCalled();
  });
  it('restores previous actor labels and original errors without writing progress', async () => {
    const f = helperFixture(undefined),
      original = new Error('original domain failure');
    await expect(
      withOwnedJobScope(f.execution, f.scope, async () => {
        throw original;
      }),
    ).rejects.toBe(original);
    const last = f.dialect.sqlToQuery(f.execute.mock.calls.at(-1)![0]);
    expect(last.params).toEqual(['prior-job', '7', '[]']);
    expect(f.update).not.toHaveBeenCalled();
  });
  it('keeps the original error when an aborted transaction rejects both cleanup statements', async () => {
    const f = helperFixture(undefined),
      original = new Error('SQL failure');
    await expect(
      withOwnedJobScope(f.execution, f.scope, async () => {
        f.execute.mockRejectedValue(new Error('transaction aborted'));
        throw original;
      }),
    ).rejects.toBe(original);
    expect(f.update).not.toHaveBeenCalled();
  });
  it('shares canonical head identity across jobs while separating tenants/entities', () => {
    const identity = { family: 'fixture.document', entityId: 'A' };
    expect(jobEffectHeadId('org-a', identity)).toBe(jobEffectHeadId('org-a', { ...identity }));
    expect(jobEffectHeadId('org-a', identity)).not.toBe(jobEffectHeadId('org-b', identity));
    expect(jobEffectHeadId('org-a', identity)).not.toBe(
      jobEffectHeadId('org-a', { ...identity, entityId: 'B' }),
    );
  });
});
