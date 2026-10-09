import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  rlsPool: vi.fn(),
  ordinaryPool: vi.fn(),
  criticalPool: vi.fn(),
}));

vi.mock('$server/db/pg-pool', () => ({
  getRlsPgClient: boundary.rlsPool,
  getPgClient: boundary.ordinaryPool,
  getCriticalPgClient: boundary.criticalPool,
  resetAllPgPools: vi.fn(),
}));

import {
  resetNotificationAudienceOperationalState,
  setupNotificationAudienceHarness,
  teardownNotificationAudienceHarness,
  type NotificationAudienceHarness,
} from '../../../../tests/fixtures/notification-audience/postgres-harness';
import {
  verifyCommandTagAdmissions,
  verifyClaimQuarantineCommandTag,
  verifyApplicantProjectionAndTerminalObservation,
  verifyDirectRoleAndCommitGuardDenials,
  verifyInvalidSubjectQuarantine,
  verifyProjectionCatalogAdmission,
  verifyProductionRequestedProjection,
  verifyStaleProjectionFence,
} from '../../../../tests/fixtures/notification-audience/runtime-cases';
import {
  verifyMalformedProjectorQuarantine,
  verifyQuarantineAuthorityAndFences,
  verifyQuarantineBatchAndInputBounds,
  verifyQuarantineRenewalRace,
  verifyQuarantineScopeRestoration,
} from '../../../../tests/fixtures/notification-audience/quarantine-cases';
import {
  verifyAuthorityCardinalityBounds,
  verifyTenThousandAndOneRecipientOverflow,
  verifyTenThousandRecipientBoundary,
} from '../../../../tests/fixtures/notification-audience/limit-cases';
import {
  verifyRevalidationAuthorityDrift,
  verifyRevalidationLockTimeout,
  verifyRevalidationSourceCancellation,
} from '../../../../tests/fixtures/notification-audience/revalidation-cases';
import { verifyTerminalObservationGrammar } from '../../../../tests/fixtures/notification-audience/observation-cases';
import {
  verifyFinalizerLockTimeouts,
  verifyFixtureCleanupBoundary,
  verifyProjectionJitIsTransactionLocal,
  verifyReplacementWinsBeforeProjection,
  verifySameGenerationRenewalBeforeProjection,
} from '../../../../tests/fixtures/notification-audience/fence-cases';

let harness: NotificationAudienceHarness;

describe('native notification audience projection', () => {
  beforeAll(async () => {
    harness = await setupNotificationAudienceHarness();
    boundary.rlsPool.mockImplementation(() => harness.worker);
    boundary.ordinaryPool.mockImplementation(() => {
      throw new Error('Ordinary pool must not serve the notification projection worker');
    });
    boundary.criticalPool.mockImplementation(() => {
      throw new Error('Critical pool must not serve the notification projection worker');
    });
  }, 120_000);

  beforeEach(async () => {
    boundary.rlsPool.mockImplementation(() => harness.worker);
    boundary.ordinaryPool.mockClear();
    boundary.criticalPool.mockClear();
    harness.workerQueries.length = 0;
    await resetNotificationAudienceOperationalState(harness);
    // The index-negative plan probe drops idx_org_members_org inside a rolled-back transaction.
    // A leak would surface as authority-budget timeouts many cases later; fail at the cause.
    expect(
      await harness.owner`select count(*)::integer as present from pg_class
        where relname='idx_org_members_org' and relkind='i'`,
    ).toEqual([{ present: 1 }]);
  });

  afterAll(async () => {
    if (harness) await teardownNotificationAudienceHarness(harness);
  }, 30_000);

  it('projects requested joins through the actual scheduler, claim, authority, finalizer, receipt and privacy boundary', async () => {
    await verifyProductionRequestedProjection(harness);
  });

  it('projects the applicant exception, observes the immutable terminal receipt after erasure, and irreversibly cancels revoked managers', async () => {
    await verifyApplicantProjectionAndTerminalObservation(harness);
  });

  it('quarantines invalid applicant identity with exact terminal attribution and no receipt or candidates', async () => {
    await verifyInvalidSubjectQuarantine(harness);
  });

  it('denies claim, application and owner attempts to bypass the finalizer and deferred commit guard', async () => {
    await verifyDirectRoleAndCommitGuardDenials(harness);
  });

  it('uses command tags to reject trigger-suppressed insert and cancellation writes without widening post-state reads', async () => {
    await verifyCommandTagAdmissions(harness);
  });

  it('rejects a stale event generation before any receipt or candidate write', async () => {
    await verifyStaleProjectionFence(harness);
  });

  it('uses the command tag for exact claim-role quarantine while terminal SELECT remains denied', async () => {
    await verifyClaimQuarantineCommandTag(harness);
  });

  it('admits the exact production projection catalog fingerprint after the full migration runner', async () => {
    await verifyProjectionCatalogAdmission(harness);
  });

  it('quarantines an exact 250-row batch atomically and rejects every malformed input boundary before effects', async () => {
    await verifyQuarantineBatchAndInputBounds(harness);
  });

  it('restores all quarantine scope settings across success, zero, savepoint error, rollback, timeout and physical connection reuse', async () => {
    await verifyQuarantineScopeRestoration(harness);
  });

  it('keeps the quarantine definer unreachable and rejects wrong organization, event, owner, generation, expiry and direct worker settlement', async () => {
    await verifyQuarantineAuthorityAndFences(harness);
  });

  it('serializes quarantine against renewal in both winner orders without stale terminal attribution', async () => {
    await verifyQuarantineRenewalRace(harness);
  });

  it('quarantines malformed projection claims through the dedicated projector transaction and clears its scope on pool reuse', async () => {
    await verifyMalformedProjectorQuarantine(harness);
  });

  it('commits exactly ten thousand recipients with one finalized receipt and exact terminal attribution', async () => {
    await verifyTenThousandRecipientBoundary(harness);
  });

  it('quarantines ten thousand and one recipients atomically without a partial receipt or candidate', async () => {
    await verifyTenThousandAndOneRecipientOverflow(harness);
  });

  it('quarantines rule and per-recipient assignment cardinality overflow without partial audience state', async () => {
    await verifyAuthorityCardinalityBounds(harness);
  });

  it('revalidates unchanged authority and irreversibly cancels authority-digest drift even after access returns', async () => {
    await verifyRevalidationAuthorityDrift(harness);
  });

  it('cancels organization, request-state and request-deletion changes with exact finite reasons', async () => {
    await verifyRevalidationSourceCancellation(harness);
  });

  it('leaves a ready candidate unchanged when bounded revalidation cannot acquire its row lock', async () => {
    await verifyRevalidationLockTimeout(harness);
  });

  it('classifies exact processing, superseded, pending, unattributed, corrupt-terminal and absent observations without replay', async () => {
    await verifyTerminalObservationGrammar(harness);
  });

  it('rolls back all audience rows when any canonical finalizer lock exceeds the bounded wait', async () => {
    await verifyFinalizerLockTimeouts(harness);
  });

  it('restores pooled JIT state after projection commit and finalizer rollback', async () => {
    await verifyProjectionJitIsTransactionLocal(harness);
  });

  it('writes zero audience rows when runtime release or organization completion commits before projection', async () => {
    await verifyReplacementWinsBeforeProjection(harness);
  });

  it('accepts fresh same-generation runtime heartbeat and organization renewal before final publication', async () => {
    await verifySameGenerationRenewalBeforeProjection(harness);
  });

  it('limits abandoned-operation cleanup to one exact tuple in a marked disposable child', async () => {
    await verifyFixtureCleanupBoundary(harness);
  });
});
