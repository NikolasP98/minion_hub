import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { openPulsePostgres } from '../test-utils/pulse-postgres';
import {
  seedPulseAuthority,
  PULSE_FIXTURE_ORG as org,
  PULSE_FIXTURE_PROFILE as profile,
} from '../test-utils/pulse-fixtures';
import {
  digestFixturePolicy,
  digestFixtureSnapshot,
  digestFixtureResponse,
} from '../test-utils/pulse-digest-fixtures';
const identity = vi.hoisted(() => ({ ctx: vi.fn() }));
vi.mock('$server/auth/core-ctx', () => ({ requireCoreCtx: identity.ctx }));
import {
  queueDigestSnapshotTx,
  admitDigestAttemptTx,
  retainDigestReceipt,
  publishDigestTx,
} from './pulse-digest.store';
import { parseDigestReceipt, validateDigestResult } from './pulse-digest.reasoning';
import { pulseDigestRuns } from '../db/pg-schema/pulse-digest';
import { bgJobs } from '../db/pg-schema/bg-jobs';
import {
  savePulseFeedback,
  getPulseFeedback,
  exportPulseFeedback,
  feedbackInputSchema,
  redactPulseFeedbackTx,
} from './pulse-feedback.service';
import { POST, GET } from '../../routes/api/pulse/proposals/[id]/feedback/+server';
import { GET as EXPORT } from '../../routes/api/pulse/feedback/export/+server';
let f: Awaited<ReturnType<typeof openPulsePostgres>>, cardId: string;
const ctx = () => ({ db: f.db, tenantId: org, profileId: profile });
beforeEach(async () => {
  f = await openPulsePostgres();
  await seedPulseAuthority(f, 'wss://fixture.invalid');
  delete process.env.MINION_PULSE_WORKER_CONFIG;
  const p = digestFixturePolicy();
  process.env.MINION_PULSE_DIGEST_POLICY = JSON.stringify(p);
  process.env.MINION_PULSE_DIGEST_SCOPE = JSON.stringify({
    tenantId: p.tenantId,
    ownerProfileId: p.ownerProfileId,
  });
  const snapshot = await digestFixtureSnapshot(p);
  const q = (await f.db.transaction((tx) => queueDigestSnapshotTx(tx, p, snapshot)))!;
  await f.pg`update bg_jobs set status='running',lease_generation=1,lease_until=${Date.now() + 60000} where id=${q.jobId}`;
  const [run] = await f.db.select().from(pulseDigestRuns).where(eq(pulseDigestRuns.id, q.runId));
  const admitted = (await f.db.transaction((tx) => admitDigestAttemptTx(tx, p, run, 1)))!;
  const receipt = parseDigestReceipt(JSON.stringify(digestFixtureResponse(snapshot)), 200);
  await retainDigestReceipt(f.db, admitted, receipt);
  const [received] = await f.db
    .select()
    .from(pulseDigestRuns)
    .where(eq(pulseDigestRuns.id, q.runId));
  const [job] = await f.db.select().from(bgJobs).where(eq(bgJobs.id, q.jobId));
  cardId = (await f.db.transaction((tx) =>
    publishDigestTx(tx, p, job, received, validateDigestResult(receipt, p, snapshot)),
  ))!;
  identity.ctx.mockImplementation(async () => ctx());
});
afterEach(async () => {
  delete process.env.MINION_PULSE_DIGEST_POLICY;
  delete process.env.MINION_PULSE_DIGEST_SCOPE;
  await f?.close();
});
function input() {
  return {
    clientActionId: randomUUID(),
    expectedContentRevision: 1,
    reason: 'useful' as const,
    comment: 'Fixture feedback',
  };
}
function event(
  method: string,
  body?: unknown,
  url = `http://127.0.0.1/api/pulse/proposals/${cardId}/feedback`,
) {
  return {
    locals: { user: { id: 'fixture-session', role: 'admin', supabaseId: profile } },
    params: { id: cardId },
    url: new URL(url),
    request: new Request(url, {
      method,
      headers: { origin: 'http://127.0.0.1', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  } as unknown as Parameters<typeof POST>[0];
}
describe('native owner feedback immutable correction and export', () => {
  it('uses actual feedback routes and idempotent actions without changing policy', async () => {
    const before = await f.pg`select * from pulse_digest_admission`;
    const payload = input();
    const first = await POST(event('POST', payload));
    const second = await POST(event('POST', payload));
    expect(await first.json()).toEqual(await second.json());
    const read = await GET(event('GET'));
    expect((await read.json()).feedback).toHaveLength(1);
    expect(await f.pg`select * from pulse_digest_admission`).toEqual(before);
    await expect(POST(event('POST', { ...payload, comment: 'different' }))).rejects.toMatchObject({
      status: 409,
    });
  });
  it('enforces strict action UUID content revision and 500 Unicode character boundary', async () => {
    const p = input();
    expect(feedbackInputSchema.safeParse({ ...p, comment: '😀'.repeat(500) }).success).toBe(true);
    expect(feedbackInputSchema.safeParse({ ...p, comment: 'x'.repeat(501) }).success).toBe(false);
    expect(feedbackInputSchema.safeParse({ ...p, clientActionId: 'x' }).success).toBe(false);
    expect(feedbackInputSchema.safeParse({ ...p, extra: true }).success).toBe(false);
    await expect(
      savePulseFeedback(ctx(), cardId, { ...p, expectedContentRevision: 2 }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(POST(event('POST', { ...p, comment: '😀'.repeat(501) }))).rejects.toMatchObject({
      status: 400,
    });
    const hostile = event('POST', p);
    hostile.request = new Request(hostile.url, {
      method: 'POST',
      headers: { origin: 'https://attacker.invalid', 'content-type': 'application/json' },
      body: JSON.stringify(p),
    });
    await expect(POST(hostile)).rejects.toMatchObject({ status: 403 });
  });
  it('permits only one successor under independent concurrent correction transactions', async () => {
    const first = await savePulseFeedback(ctx(), cardId, input());
    const correction = {
      ...input(),
      reason: 'fact_error' as const,
      supersedesFeedbackId: first.id,
    };
    const results = await Promise.allSettled([
      savePulseFeedback(ctx(), cardId, correction),
      savePulseFeedback({ ...ctx(), db: f.peerDb }, cardId, {
        ...correction,
        clientActionId: randomUUID(),
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await getPulseFeedback(ctx(), cardId)).toHaveLength(2);
    await expect(
      savePulseFeedback(ctx(), cardId, { ...input(), supersedesFeedbackId: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      f.pg`update pulse_feedback set reason='irrelevant' where id=${first.id}`,
    ).rejects.toThrow('append only');
  });
  it('denies another current owner cross-org missing member and stale card reads', async () => {
    const other = randomUUID();
    await f.pg`insert into organization_members(organization_id,profile_id,role)values(${org},${other},'owner')`;
    await expect(getPulseFeedback({ ...ctx(), profileId: other }, cardId)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      savePulseFeedback({ ...ctx(), profileId: other }, cardId, input()),
    ).rejects.toMatchObject({ status: 404 });
    await expect(getPulseFeedback({ ...ctx(), tenantId: randomUUID() }, cardId)).rejects.toThrow();
    await f.pg`delete from organization_members where profile_id=${profile}`;
    await expect(savePulseFeedback(ctx(), cardId, input())).rejects.toThrow('owner_unavailable');
  });
  it('exports bounded owner-only keyset JSONL partitioning factual from preference', async () => {
    const initial = (
      await (await POST(event('POST', { ...input(), comment: '😀'.repeat(500) }))).json()
    ).feedback;
    expect(Array.from(initial.comment).length).toBe(500);
    await savePulseFeedback(ctx(), cardId, {
      ...input(),
      reason: 'fact_error',
      supersedesFeedbackId: initial.id,
    });
    await savePulseFeedback(ctx(), cardId, { ...input(), reason: 'irrelevant' });
    const response = await EXPORT(
      event(
        'GET',
        undefined,
        'http://127.0.0.1/api/pulse/feedback/export?limit=2',
      ) as unknown as Parameters<typeof EXPORT>[0],
    );
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    const text = await response.text();
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(262144);
    const lines = text
      .trim()
      .split('\n')
      .map((s) => JSON.parse(s));
    expect(lines[0].automaticLearning).toBe(false);
    expect(lines).toHaveLength(4);
    expect(
      lines
        .slice(1, 3)
        .map((l) => l.group)
        .sort(),
    ).toEqual(['factual_errors', 'preference_relevance']);
    const next = lines[3].nextCursor;
    expect(next).toBeTruthy();
    const more = await exportPulseFeedback(ctx(), new URLSearchParams({ limit: '2', after: next }));
    expect(more.trim().split('\n')).toHaveLength(3);
    await expect(
      exportPulseFeedback(ctx(), new URLSearchParams({ limit: '101' })),
    ).rejects.toMatchObject({ status: 400 });
    if (process.env.MINION_DIGEST_FEEDBACK_EVIDENCE) {
      const exported = await (
        await EXPORT(
          event(
            'GET',
            undefined,
            'http://127.0.0.1/api/pulse/feedback/export?limit=100',
          ) as unknown as Parameters<typeof EXPORT>[0],
        )
      ).text();
      const file = process.env.MINION_DIGEST_FEEDBACK_EVIDENCE;
      writeFileSync(file, exported, { mode: 0o600 });
      const pins = Object.fromEntries(
        [
          'src/server/services/pulse-feedback.service.ts',
          'src/routes/api/pulse/feedback/export/+server.ts',
          'supabase/migrations/20261023020000_pulse_digest.sql',
        ].map((path) => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]),
      );
      writeFileSync(
        file + '.receipt.json',
        JSON.stringify(
          {
            schema: 'pulse-feedback-v1',
            revision: 1,
            transport: 'actual GET /api/pulse/feedback/export?limit=100',
            storage:
              'real marked disposable PostgreSQL, real migration, actual feedback service/route',
            sourceBase: '4c9b5bf19d9e298df2795324f3f9f8f105b3cf08',
            exportSha256: createHash('sha256').update(exported).digest('hex'),
            bytes: Buffer.byteLength(exported),
            records: 3,
            nextCursor: null,
            automaticLearning: false,
            adjudicatedGold: false,
            pins,
          },
          null,
          2,
        ) + '\n',
        { mode: 0o600 },
      );
    }
    await f.pg`insert into permission_rules(org_id,role_key,module,can_view,can_create,can_edit,can_delete,can_export,can_manage)values(${org},'owner','pulse',true,true,true,true,false,true)`;
    await expect(exportPulseFeedback(ctx(), new URLSearchParams())).rejects.toThrow(
      'owner_unavailable',
    );
  });
  it('redacts expired comments using actual bounded cleanup and retains hashes history and billing', async () => {
    const saved = await savePulseFeedback(ctx(), cardId, input());
    await f.pg.unsafe('alter table pulse_feedback disable trigger pulse_feedback_guard');
    await f.pg`update pulse_feedback set created_at=now()-interval '31 days' where id=${saved.id}`;
    await f.pg.unsafe('alter table pulse_feedback enable trigger pulse_feedback_guard');
    expect(
      await f.db.transaction((tx) =>
        redactPulseFeedbackTx(tx, { tenantId: org, profileId: profile }),
      ),
    ).toBe(1);
    const [r] = await getPulseFeedback(ctx(), cardId);
    expect(r.comment).toBeNull();
    expect(r.payloadHash).toBe(saved.payloadHash);
    expect(r.redactedAt).toBeTruthy();
    expect((await f.pg`select cost_micro_usd from pulse_digest_runs`)[0].cost_micro_usd).toBe(
      '100',
    );
  });
});
