<script lang="ts">
  import PlanOpenForm from '$lib/components/pos/PlanOpenForm.svelte';
  import { PlanContinuationError } from '$lib/components/pos/plan-open-operation.svelte';
  import {
    PlanOpenPersistence,
    serializePendingPlanOperation,
    type FrozenPlanCartRow,
    type PendingPlanOperation,
  } from '$lib/components/pos/plan-open-persistence';

  const orgId = 'fixture-org';
  const preCart: FrozenPlanCartRow[] = [
    {
      productId: 'fixture-service',
      kind: 'service',
      qty: '1',
      unitPrice: '120',
      discount: '0',
      bookingId: null,
      redemptionId: null,
      planId: null,
    },
  ];
  const postCart: FrozenPlanCartRow[] = [
    {
      productId: 'plan:fixture-plan-restore',
      kind: 'service',
      qty: 1,
      unitPrice: 40,
      discount: 0,
      bookingId: null,
      redemptionId: null,
      planId: 'fixture-plan-restore',
    },
  ];

  function record(
    actorId: string,
    operationId: string,
    stage: PendingPlanOperation['stage'],
    planId: string | null,
    continuation: PendingPlanOperation['continuation'],
  ): PendingPlanOperation {
    return {
      version: 1,
      actorId,
      orgId,
      operationId,
      stage,
      intent: {
        partyId: 'fixture-party',
        crmContactId: null,
        bookingId: null,
        productId: null,
        title: 'Fixture treatment plan',
        totalAmount: 120,
        currency: { kind: 'omitted' },
        dueSchedule: [
          { dueOn: '2027-01-15', amount: 40 },
          { dueOn: '2027-02-15', amount: 40 },
          { dueOn: '2027-03-15', amount: 40 },
        ],
        note: 'Visible frozen note',
      },
      planId,
      continuation,
    };
  }

  const states = [
    record('fixture-unknown', '11111111-1111-4111-8111-111111111111', 'unknown', null, {
      kind: 'account',
      clientKey: 'party:fixture-party',
    }),
    record(
      'fixture-committed',
      '22222222-2222-4222-8222-222222222222',
      'committed_refresh',
      'fixture-plan-committed',
      { kind: 'account', clientKey: 'party:fixture-party' },
    ),
    record(
      'fixture-restore',
      '33333333-3333-4333-8333-333333333333',
      'continuation_pending',
      'fixture-plan-restore',
      {
        kind: 'sell',
        partyId: 'fixture-party',
        bookingId: null,
        preCart,
        postCart,
      },
    ),
  ];
  const persistence = new PlanOpenPersistence();
  for (const state of states) {
    localStorage.setItem(
      persistence.storageKey({ actorId: state.actorId, orgId }),
      serializePendingPlanOperation(state),
    );
  }

  const noop = () => {};
</script>

<main data-fixture-version="hc035-v10">
  <header>
    <p class="eyebrow t-label">HC-035 browser evidence</p>
    <h1 class="t-heading">Durable plan recovery states</h1>
    <p class="intro t-body">
      Actual PlanOpenForm production component with bounded local fixture data.
    </p>
  </header>

  <div class="grid">
    <section id="unknown-state" aria-labelledby="unknown-title">
      <h2 class="t-title" id="unknown-title">Unresolved request</h2>
      <p class="description t-body">
        The create response is unknown. A second create remains blocked.
      </p>
      <PlanOpenForm
        partyId="fixture-party"
        mutationScope="pos:fixture-org"
        actorId="fixture-unknown"
        {orgId}
        continuation={{ kind: 'account', clientKey: 'party:fixture-party' }}
        defaultTitle="Current default"
        oncreated={noop}
        oncancel={noop}
      />
    </section>

    <section id="committed-state" aria-labelledby="committed-title">
      <h2 class="t-title" id="committed-title">Committed recovery</h2>
      <p class="description t-body">
        The exact plan is known while its account refresh still needs repair.
      </p>
      <PlanOpenForm
        partyId="fixture-party"
        mutationScope="pos:fixture-org"
        actorId="fixture-committed"
        {orgId}
        continuation={{ kind: 'account', clientKey: 'party:fixture-party' }}
        defaultTitle="Current default"
        oncreated={noop}
        oncancel={noop}
      />
    </section>

    <section id="restore-state" aria-labelledby="restore-title">
      <h2 class="t-title" id="restore-title">Explicit cart restore</h2>
      <p class="description t-body">
        Choose Check account, then Restore pending sale to inspect the replacement confirmation.
      </p>
      <PlanOpenForm
        partyId="fixture-party"
        mutationScope="pos:fixture-org"
        actorId="fixture-restore"
        {orgId}
        continuation={{
          kind: 'sell',
          partyId: 'fixture-party',
          bookingId: null,
          preCart,
          postCart,
        }}
        defaultTitle="Current default"
        oncreated={async (_plan, owner) => {
          if (!owner.allowCartReplace) {
            throw new PlanContinuationError('cart_restore_required');
          }
          throw new PlanContinuationError('cart_projection_invalid');
        }}
        oncancel={noop}
      />
    </section>
  </div>
</main>

<style>
  main {
    min-height: 100vh;
    padding: var(--space-6);
    background: var(--color-canvas);
    color: var(--color-text-primary);
  }
  header {
    max-width: 72rem;
    margin: 0 auto var(--space-6);
  }
  h1,
  h2,
  p {
    margin: 0;
  }
  h1 {
    margin-top: var(--space-1);
  }
  .eyebrow,
  .description,
  .intro {
    color: var(--color-text-secondary);
  }
  .intro,
  .description {
    margin-top: var(--space-2);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 19rem), 1fr));
    gap: var(--space-4);
    max-width: 72rem;
    margin: 0 auto;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
    box-shadow: var(--shadow-sm);
  }
  @media (max-width: 640px) {
    main {
      padding: var(--space-3);
    }
  }
</style>
