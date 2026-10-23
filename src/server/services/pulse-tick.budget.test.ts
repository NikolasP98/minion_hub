import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobTransaction } from './bg-runtime';

const boundary = vi.hoisted(() => ({
  monotonic: 0,
  wall: 1_800_000_000_000,
  authorityMs: 1234,
  retentionMs: 4321,
  digestRedact: vi.fn(async () => {}),
  feedbackRedact: vi.fn(async () => {}),
  selected: vi.fn(async () => ({ advanced: 1 })),
}));
vi.mock('./pulse-dispatch.worker', () => ({}));
vi.mock('./pulse-digest.worker', () => ({}));
vi.mock('./pulse-digest.store', () => ({
  redactDigestTx: boundary.digestRedact,
  cancelDigestForOwnerTx: async () => {},
}));
vi.mock('./pulse-feedback.service', () => ({ redactPulseFeedbackTx: boundary.feedbackRedact }));
vi.mock('./bg-runtime', () => ({ runSelectedTick: boundary.selected }));
vi.mock('./pulse-worker-config', () => ({
  readPulseWorkerConfig: () => ({ tenantId: 'org-budget', ownerProfileId: 'owner-budget' }),
  readPulseWorkerScope: () => null,
  assertPulseConfigCurrent: () => {},
}));
vi.mock('$server/db/pg-client', () => ({
  getCoreDb: () => ({}),
  getOrgTransactionDb: () => ({
    transaction: (operation: (tx: JobTransaction) => Promise<unknown>) =>
      operation({} as JobTransaction),
  }),
}));
vi.mock('./pulse-dispatch.authority', () => ({
  resolvePulseAuthorityTx: async () => {
    boundary.monotonic += boundary.authorityMs;
    boundary.wall -= 60_000;
  },
}));
vi.mock('./pulse-dispatch.store', () => ({
  cancelPulseForOwnerTx: async () => {},
  redactExpiredPulsePayloadsTx: async () => {
    boundary.monotonic += boundary.retentionMs;
    boundary.wall -= 60_000;
  },
}));
import { runPulseTick } from './pulse-tick';

beforeEach(() => {
  boundary.monotonic = 0;
  boundary.authorityMs = 1234;
  boundary.retentionMs = 4321;
  boundary.selected.mockClear();
  boundary.digestRedact.mockClear();
  boundary.feedbackRedact.mockClear();
  vi.spyOn(performance, 'now').mockImplementation(() => boundary.monotonic);
  vi.spyOn(Date, 'now').mockImplementation(() => boundary.wall);
});
afterEach(() => {
  delete process.env.MINION_PULSE_DIGEST_SCOPE;
  vi.restoreAllMocks();
});

describe('Pulse tick total monotonic budget', () => {
  it('subtracts authority and retention time despite backward wall-clock changes', async () => {
    expect(await runPulseTick()).toEqual({ advanced: 1 });
    expect(boundary.selected).toHaveBeenCalledExactlyOnceWith({
      tenantId: 'org-budget',
      ownerProfileId: 'owner-budget',
      types: ['pulse_dispatch'],
      budgetMs: 44_445,
      maxCandidates: 20,
    });
  });
  it('cannot admit work after authority and retention exhaust the total budget', async () => {
    boundary.authorityMs = 48_000;
    boundary.retentionMs = 2001;
    expect(await runPulseTick()).toEqual({ advanced: 0 });
    expect(boundary.selected).not.toHaveBeenCalled();
  });
  it('stops retained maintenance at the monotonic deadline before another family or admission', async () => {
    process.env.MINION_PULSE_DIGEST_SCOPE = JSON.stringify({
      tenantId: '00000000-0000-4000-8000-000000000001',
      ownerProfileId: '00000000-0000-4000-8000-000000000002',
    });
    boundary.retentionMs = 50_001;
    expect(await runPulseTick()).toEqual({ advanced: 0 });
    expect(boundary.digestRedact).not.toHaveBeenCalled();
    expect(boundary.feedbackRedact).not.toHaveBeenCalled();
    expect(boundary.selected).not.toHaveBeenCalled();
  });
});
