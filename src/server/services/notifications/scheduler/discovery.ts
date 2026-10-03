import type { NotificationWorkerTx } from '../worker-transaction';
import { NotificationWorkerUnavailable } from '../worker-failure';
import {
  assertRuntimeLease,
  assertGenerationCanAdvance,
  NotificationSchedulerUnavailable,
  type OrganizationLease,
  type RuntimeLease,
} from './contracts';
import { lockRuntimeFence } from './organization-lease';
import { withCoordinator } from './transaction';

type State = 'pending' | 'processing';
type Cursor = {
  pending_after_org: string | null;
  processing_after_org: string | null;
  next_state: State;
  tick_generation: string;
  now: string;
};
type Control = { state: 'idle' | 'running'; generation: string; due: boolean; live: boolean };
export type DiscoveryResult = Readonly<{
  state: 'claimed' | 'idle' | 'coordinator_busy' | 'lease_lost';
  leases: readonly OrganizationLease[];
  candidates: number;
}>;

/** Counts timeout setters and setup/final transaction statements, not just data SELECTs. */
class DiscoveryBudget {
  constructor(private readonly signal?: AbortSignal) {}
  assertActive() {
    if (this.signal?.aborted) throw new NotificationWorkerUnavailable('deadline');
  }
  private used = 3; // BEGIN, transaction setup, eventual COMMIT.
  private readonly started = performance.now();
  remainingMs() {
    return 3000 - (performance.now() - this.started);
  }
  canReserve(statements: number) {
    return this.used + statements <= 64 && this.remainingMs() > 0;
  }
  async query<T>(tx: NotificationWorkerTx, read: () => PromiseLike<T>): Promise<T> {
    this.assertActive();
    if (!this.canReserve(2)) throw new NotificationWorkerUnavailable('deadline');
    this.used += 2;
    await tx`select set_config('statement_timeout',${Math.max(1, Math.floor(this.remainingMs())) + 'ms'},true)`;
    if (this.remainingMs() <= 0) throw new NotificationWorkerUnavailable('deadline');
    const result = await read();
    this.assertActive();
    return result;
  }
}

async function seek(
  tx: NotificationWorkerTx,
  budget: DiscoveryBudget,
  state: State,
  after: string | null,
) {
  // Separate predicates preserve both state-specific partial indexes. A seek skips
  // the entire previous organization; no DISTINCT scan over its event population.
  const rows = await budget.query(tx, () =>
    state === 'pending'
      ? after === null
        ? tx<
            { organization_id: string }[]
          >`select organization_id from public.notification_outbox where state='pending' order by organization_id limit 1`
        : tx<
            { organization_id: string }[]
          >`select organization_id from public.notification_outbox where state='pending' and organization_id>${after}::uuid order by organization_id limit 1`
      : after === null
        ? tx<
            { organization_id: string }[]
          >`select organization_id from public.notification_outbox where state='processing' order by organization_id limit 1`
        : tx<
            { organization_id: string }[]
          >`select organization_id from public.notification_outbox where state='processing' and organization_id>${after}::uuid order by organization_id limit 1`,
  );
  return rows[0]?.organization_id ?? null;
}

async function lockControl(
  tx: NotificationWorkerTx,
  budget: DiscoveryBudget,
  organizationId: string,
) {
  return budget.query(
    tx,
    () => tx<Control[]>`
    select state,generation::text,next_due_at<=clock_timestamp() as due,
      coalesce(lease_expires_at>clock_timestamp(),false) as live
    from public.notification_org_control where organization_id=${organizationId}::uuid for update skip locked`,
  );
}

export async function discoverNotificationOrganizations(
  runtime: RuntimeLease,
  supported: readonly string[],
  maximumClaims = 4,
  signal?: AbortSignal,
): Promise<DiscoveryResult> {
  assertRuntimeLease(runtime);
  if (!Number.isInteger(maximumClaims) || maximumClaims < 1 || maximumClaims > 4)
    throw new Error('Invalid notification discovery capacity');
  if (
    supported.length < 1 ||
    supported.length > 8 ||
    new Set(supported).size !== supported.length ||
    supported.some((v) => !/^[A-Za-z0-9][A-Za-z0-9._:+-]{0,63}$/.test(v))
  )
    throw new Error('Invalid notification catalog support');
  const versions = Object.freeze([...supported].sort());
  const budget = new DiscoveryBudget(signal);
  return withCoordinator(runtime.ownerId, runtime.generation, async (tx) => {
    const [cursor] = await budget.query(
      tx,
      () => tx<Cursor[]>`
      select pending_after_org,processing_after_org,next_state,tick_generation::text,clock_timestamp()::text as now
      from public.notification_scheduler_cursor where singleton and schema_version=1 for update skip locked`,
    );
    if (!cursor) {
      const [present] = await budget.query(
        tx,
        () =>
          tx<
            { present: boolean }[]
          >`select exists(select 1 from public.notification_scheduler_cursor where singleton and schema_version=1) as present`,
      );
      if (!present?.present) throw new NotificationSchedulerUnavailable('state_missing');
      return Object.freeze({ state: 'coordinator_busy', leases: Object.freeze([]), candidates: 0 });
    }
    assertGenerationCanAdvance(cursor.tick_generation);
    if (!(await budget.query(tx, () => lockRuntimeFence(tx, runtime, true)))) {
      const [current] = await budget.query(
        tx,
        () => tx<{ valid: boolean }[]>`select public.notification_scheduler_fence() as valid`,
      );
      return Object.freeze({
        state: current?.valid ? 'coordinator_busy' : 'lease_lost',
        leases: Object.freeze([]),
        candidates: 0,
      });
    }
    const [active] = await budget.query(
      tx,
      () => tx<{ count: number }[]>`
      select count(*)::int as count from(select organization_id from public.notification_org_control
        where state='running' and lease_expires_at>${cursor.now}::timestamptz order by lease_expires_at,organization_id limit 4) active`,
    );
    const capacity = Math.min(maximumClaims, Math.max(0, 4 - active.count));
    const positions = {
      pending: cursor.pending_after_org,
      processing: cursor.processing_after_org,
    };
    const observed = { pending: 0, processing: 0 };
    const wrapped = { pending: false, processing: false };
    let next: State = cursor.next_state;
    const leases: OrganizationLease[] = [];
    let candidates = 0;
    // Worst case: seek, lock, insert, relock, DB clock, each revision probe,
    // one claim/idle observation, plus final cursor publication and fence.
    const candidateStatements = 2 * (7 + versions.length);
    while (
      leases.length < capacity &&
      candidates < 16 &&
      budget.canReserve(candidateStatements + 4) &&
      budget.remainingMs() > 50
    ) {
      let state = next;
      next = state === 'pending' ? 'processing' : 'pending';
      if (observed[state] >= 8 || wrapped[state]) state = next;
      if (observed[state] >= 8 || wrapped[state]) break;
      next = state === 'pending' ? 'processing' : 'pending';
      const organizationId = await seek(tx, budget, state, positions[state]);
      candidates++;
      observed[state]++;
      if (organizationId === null) {
        positions[state] = null;
        wrapped[state] = true;
        continue;
      }
      // The new position is tentative until the full eligibility decision. On
      // elapsed budget the next tick revisits this organization rather than skips it.
      if (budget.remainingMs() <= 50) break;
      let [control] = await lockControl(tx, budget, organizationId);
      if (!control) {
        const [existing] = await budget.query(
          tx,
          () =>
            tx<
              { present: boolean }[]
            >`select exists(select 1 from public.notification_org_control where organization_id=${organizationId}::uuid) as present`,
        );
        if (existing.present) {
          positions[state] = organizationId;
          continue;
        }
        await budget.query(
          tx,
          () =>
            tx`insert into public.notification_org_control(organization_id) values(${organizationId}::uuid) on conflict do nothing`,
        );
        [control] = await lockControl(tx, budget, organizationId);
      }
      if (!control || !control.due || control.live) {
        positions[state] = organizationId;
        continue;
      }
      const [clock] = await budget.query(
        tx,
        () => tx<{ now: string }[]>`select clock_timestamp()::text as now`,
      );
      let eligible = false;
      for (const revision of versions) {
        if (budget.remainingMs() <= 50) break;
        const [row] = await budget.query(tx, () =>
          state === 'pending'
            ? tx<
                { found: boolean }[]
              >`select exists(select 1 from public.notification_outbox where organization_id=${organizationId}::uuid and state='pending' and catalog_revision=${revision} collate "C" limit 1) as found`
            : tx<
                { found: boolean }[]
              >`select exists(select 1 from public.notification_outbox where organization_id=${organizationId}::uuid and state='processing' and catalog_revision=${revision} collate "C" and lease_expires_at<=${clock.now}::timestamptz limit 1) as found`,
        );
        if (row.found) {
          eligible = true;
          break;
        }
      }
      if (budget.remainingMs() <= 50) break;
      if (!eligible) {
        // Live processing and unknown revisions remain untouched. Only an idle
        // control gets observation backoff; this is not a projection completion.
        if (control.state === 'idle')
          await budget.query(
            tx,
            () => tx`
          update public.notification_org_control set next_due_at=clock_timestamp()+interval '5 seconds',last_result='empty'
          where organization_id=${organizationId}::uuid and state='idle' and generation=${control.generation}::bigint`,
          );
        positions[state] = organizationId;
        continue;
      }
      assertGenerationCanAdvance(control.generation);
      const claimStarted = performance.now();
      const [claim] = await budget.query(
        tx,
        () => tx<{ generation: string; expires_at: string; hard_deadline: string }[]>`
        with stamp as materialized(select clock_timestamp() as value)
        update public.notification_org_control set state='running',generation=generation+1,owner_id=${runtime.ownerId}::uuid,
          claimed_at=stamp.value,lease_expires_at=stamp.value+interval '30 seconds',hard_deadline=stamp.value+interval '60 seconds',renewal_count=0
        from stamp where organization_id=${organizationId}::uuid and generation=${control.generation}::bigint
          and next_due_at<=stamp.value and (state='idle' or lease_expires_at<=stamp.value)
        returning generation::text,lease_expires_at::text as expires_at,hard_deadline::text`,
      );
      if (claim)
        leases.push(
          Object.freeze({
            organizationId,
            ownerId: runtime.ownerId,
            generation: claim.generation,
            expiresAt: claim.expires_at,
            hardDeadline: claim.hard_deadline,
            hardDeadlineMonotonic: claimStarted + 60000,
          }),
        );
      positions[state] = organizationId;
    }
    // The trigger checks the live worker again. On SQL timeout the whole transaction
    // rolls back, including cursor progress and every admitted organization claim.
    await budget.query(
      tx,
      () => tx`
      update public.notification_scheduler_cursor set pending_after_org=${positions.pending}::uuid,
        processing_after_org=${positions.processing}::uuid,next_state=${next},tick_generation=tick_generation+1
      where singleton and schema_version=1 and tick_generation=${cursor.tick_generation}::bigint`,
    );
    const [fence] = await budget.query(
      tx,
      () => tx<{ valid: boolean }[]>`select public.notification_scheduler_fence() as valid`,
    );
    if (!fence?.valid) throw new NotificationSchedulerUnavailable('state_invalid');
    budget.assertActive();
    return Object.freeze({
      state: leases.length ? 'claimed' : 'idle',
      leases: Object.freeze(leases),
      candidates,
    });
  });
}
