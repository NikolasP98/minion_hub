import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  runTick: vi.fn(),
  inbox: vi.fn(),
  followUps: vi.fn(),
  reap: vi.fn(),
}));
vi.mock('$env/dynamic/private', () => ({ env: { CRON_SECRET: 's3cret' } }));
vi.mock('$server/services/bg-runtime', () => ({ runTick: h.runTick }));
vi.mock('$server/services/inbox/evaluate', () => ({ evaluateInboxRules: h.inbox }));
vi.mock('$server/services/doors-followup.service', () => ({ runDoorFollowUps: h.followUps }));
vi.mock('$server/services/stale-sends.service', () => ({ reapStaleSends: h.reap }));
vi.mock('$server/services/groupchat.service', () => ({}));
vi.mock('$server/services/brains.service', () => ({}));
vi.mock('$server/services/brain-corpus-jobs.service', () => ({}));
vi.mock('$server/services/brain-business-corpus-jobs.service', () => ({}));
vi.mock('$server/services/finance-statements.service', () => ({}));

import { GET } from './+server';

const call = (qs = '') =>
  GET({
    request: new Request(`http://hub.test/api/jobs/tick${qs}`, {
      headers: { authorization: 'Bearer s3cret' },
    }),
  } as never) as Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  h.inbox.mockResolvedValue([]);
  h.followUps.mockResolvedValue({ orgs: 1, sent: 1, failed: 0, skipped: 0, held: 0, errors: 0 });
  h.reap.mockResolvedValue({ reminders: 1, followups: 0, emissions: 2 });
});

describe('GET /api/jobs/tick — door follow-ups (spec 041 S4)', () => {
  it('runs the follow-up sweep without ?jobs=1 and reports it', async () => {
    const body = await (await call()).json();
    expect(h.runTick).not.toHaveBeenCalled();
    expect(h.followUps).toHaveBeenCalledTimes(1);
    expect(body.followUps.sent).toBe(1);
  });

  it('a throwing sweep is isolated: the tick still answers, inbox result intact', async () => {
    h.followUps.mockRejectedValue(new Error('boom +51900000041'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.followUps).toEqual({ error: 'door_follow_ups_failed' });
    expect(body.inbox).toEqual([]);
    expect(JSON.stringify(err.mock.calls)).not.toContain('+51900000041');
    err.mockRestore();
  });
});

describe('GET /api/jobs/tick — stale sends (spec 118 slice 2)', () => {
  it('reaps stale sends on every tick, without ?jobs=1, and reports the counts', async () => {
    const body = await (await call()).json();
    expect(h.reap).toHaveBeenCalledTimes(1);
    expect(body.staleSends).toEqual({ reminders: 1, followups: 0, emissions: 2 });
  });

  it('a throwing sweep is isolated from the other jobs', async () => {
    h.reap.mockRejectedValue(new Error('boom'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.staleSends).toEqual({ error: 'stale_sends_failed' });
    expect(body.inbox).toEqual([]);
    expect(body.followUps.sent).toBe(1);
    err.mockRestore();
  });
});
