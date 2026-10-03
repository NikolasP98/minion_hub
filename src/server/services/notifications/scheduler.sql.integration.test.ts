import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
  resetNotificationSchedulerHarness,
  setupNotificationSchedulerHarness,
  teardownNotificationSchedulerHarness,
  type NotificationSchedulerHarness,
} from '../../../../tests/fixtures/notification-scheduler/postgres-harness';
import {
  verifyAdmissionObservationOwnership,
  verifyCoordinatorPoolRestoration,
  verifyHeldRuntimeContention,
  verifyOrganizationLeaseFencing,
  verifyRuntimeLeaseOwnership,
} from '../../../../tests/fixtures/notification-scheduler/runtime-cases';
import { verifySchedulerAuthorityBoundary } from '../../../../tests/fixtures/notification-scheduler/authority-cases';
import {
  verifyAmbiguousAbandonReconciliation,
  verifyDiscoveryAbortAndAbandon,
  verifyDiscoveryFairnessAndCapacity,
  verifyInFlightDiscoveryAbort,
  verifyDiscoverySkipsHeldRows,
} from '../../../../tests/fixtures/notification-scheduler/discovery-cases';
import { verifyHealthIsolationAndRestoration } from '../../../../tests/fixtures/notification-scheduler/health-cases';
import { verifyProductionPlans } from '../../../../tests/fixtures/notification-scheduler/plan-cases';
import {
  verifyGenerationOverflowFailsClosed,
  verifyMissingAndUnknownSingletons,
} from '../../../../tests/fixtures/notification-scheduler/edge-cases';

let harness: NotificationSchedulerHarness;

describe('native notification scheduler ownership', () => {
  beforeAll(async () => {
    harness = await setupNotificationSchedulerHarness();
    boundary.rlsPool.mockImplementation(() => harness.worker);
    boundary.ordinaryPool.mockImplementation(() => {
      throw new Error('Ordinary PostgreSQL pool must not serve notification scheduler operations');
    });
    boundary.criticalPool.mockImplementation(() => {
      throw new Error('Critical PostgreSQL pool must not serve notification scheduler operations');
    });
  }, 90_000);

  afterAll(async () => {
    if (harness) await teardownNotificationSchedulerHarness(harness);
  }, 30_000);

  beforeEach(async () => {
    vi.clearAllMocks();
    boundary.rlsPool.mockImplementation(() => harness.worker);
    await resetNotificationSchedulerHarness(harness);
  });

  afterEach(async () => {
    expect(boundary.ordinaryPool).not.toHaveBeenCalled();
    expect(boundary.criticalPool).not.toHaveBeenCalled();
    expect(
      await harness.owner<{ name: string; enabled: string }[]>`
        select tgname as name,tgenabled as enabled from pg_trigger
        where tgname in ('notification_runtime_transition','notification_cursor_transition',
          'notification_control_transition') order by tgname`,
    ).toEqual([
      { name: 'notification_control_transition', enabled: 'O' },
      { name: 'notification_cursor_transition', enabled: 'O' },
      { name: 'notification_runtime_transition', enabled: 'O' },
    ]);
  });

  it('applies the worker scheduler through the production runner with exact durable roles, marker and no-op replay', async () => {
    expect(harness.schedulerMigration.error).toBeUndefined();
    expect(harness.schedulerMigration.signal).toBeNull();
    expect(harness.schedulerMigration.code, harness.schedulerMigration.stderr).toBe(0);
    expect(harness.schedulerMigration.stdout).toContain('db:migrate — applying 20261003160000');
    expect(harness.schedulerStatus.code, harness.schedulerStatus.stderr).toBe(0);
    expect(harness.schedulerStatus.stdout).toContain('0 pending');
    expect(harness.schedulerRerun.code, harness.schedulerRerun.stderr).toBe(0);
    expect(harness.schedulerRerun.stdout).toContain('db:migrate — done (0 applied).');

    expect(
      await harness.owner`select version from public.hub_migrations
        where version='20261003160000'`,
    ).toEqual([{ version: '20261003160000' }]);
    expect(
      await harness.parent.owner<{ marker: string | null }[]>`
        select shobj_description(oid,'pg_database') as marker from pg_database
        where datname=${harness.childName}`,
    ).toEqual([{ marker: `minion-notification-scheduler-child:v1:${harness.fixtureOwnerId}` }]);
    expect(
      await harness.owner<
        {
          role: string;
          login: boolean;
          super: boolean;
          bypass: boolean;
          inherit: boolean;
          member: boolean;
        }[]
      >`select r.rolname as role,r.rolcanlogin as login,r.rolsuper as super,
        r.rolbypassrls as bypass,r.rolinherit as inherit,
        pg_has_role(current_user,r.oid,'MEMBER') as member
        from pg_roles r where r.rolname in ('notification_coordinator','notification_health_reader')
        order by r.rolname`,
    ).toEqual([
      {
        role: 'notification_coordinator',
        login: false,
        super: false,
        bypass: false,
        inherit: false,
        member: true,
      },
      {
        role: 'notification_health_reader',
        login: false,
        super: false,
        bypass: false,
        inherit: false,
        member: true,
      },
    ]);
    expect(
      await harness.owner`
        select singleton,schema_version,generation::text,owner_id,lease_expires_at,
          admission_generation::text,admission_owner_id,admission_code
        from public.notification_worker_runtime`,
    ).toEqual([
      {
        singleton: true,
        schema_version: 1,
        generation: '0',
        owner_id: null,
        lease_expires_at: null,
        admission_generation: '0',
        admission_owner_id: null,
        admission_code: null,
      },
    ]);
  });

  it('fences global scheduler ownership across standby, heartbeat, expiry, replacement and stale release', async () => {
    await verifyRuntimeLeaseOwnership(harness);
  });

  it('rate bounds durable failed-admission observations and cannot overwrite a live runtime', async () => {
    await verifyAdmissionObservationOwnership(harness);
  });

  it('fences organization renewal and settlement by live runtime owner and monotonic generation', async () => {
    await verifyOrganizationLeaseFencing(harness);
  });

  it('restores coordinator role, GUCs and pool state after callback and statement timeout failures', async () => {
    await verifyCoordinatorPoolRestoration(harness);
  });

  it('waits through a held runtime row for heartbeat, organization renewal and completion without reporting lease loss', async () => {
    await verifyHeldRuntimeContention(harness);
  }, 15_000);

  it('enforces exact coordinator and health-reader role, RLS, column and generation boundaries', async () => {
    await verifySchedulerAuthorityBoundary(harness);
  });

  it('alternates pending and expired discovery fairly under the four-claim and sixteen-candidate ceilings', async () => {
    await verifyDiscoveryFairnessAndCapacity(harness);
  });

  it('returns coordinator busy for a held cursor and advances past a separately held organization row', async () => {
    await verifyDiscoverySkipsHeldRows(harness);
  });

  it('rolls back pre-aborted discovery and explicitly abandons only an exact unstarted organization claim', async () => {
    await verifyDiscoveryAbortAndAbandon(harness);
  });

  it('rolls back an in-flight aborted discovery without advancing its cursor or stranding a claim', async () => {
    await verifyInFlightDiscoveryAbort(harness);
  }, 15_000);

  it('reconciles a failed unstarted-claim abandon through exact live receipt expiry before releasing global ownership', async () => {
    await verifyAmbiguousAbandonReconciliation(harness);
  }, 20_000);

  it('isolates organization health and restores the pooled role and GUCs after success and SQL timeout', async () => {
    await verifyHealthIsolationAndRestoration(harness);
  }, 15_000);

  it('fails closed without repairing missing or unknown-version runtime and cursor singletons', async () => {
    await verifyMissingAndUnknownSingletons(harness);
  });

  it('rejects bigint generation exhaustion for runtime, admission, organization and cursor state without resetting history', async () => {
    await verifyGenerationOverflowFailsClosed(harness);
  });

  it('uses bounded production discovery and health SQL plans across one hundred thousand rows and fails when required indexes are removed', async () => {
    await verifyProductionPlans(harness, (client) => {
      boundary.rlsPool.mockImplementation(() => client);
    });
  }, 180_000);
});
