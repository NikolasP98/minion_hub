<script lang="ts">
  import { untrack } from 'svelte';
  import type { StoredCustomer } from '../customer-storage';
  import type { CartLine, SellCartSellable } from '../SellCart.svelte';
  import {
    createSellSessionCoordinator,
    sellPlanInstalmentLine,
    type SellChargeClaim,
  } from '../sell-session.svelte';
  import type { SellChargeStorage } from '../sell-charge-handoff';
  import { Button } from '$lib/components/ui';

  let {
    actorId,
    orgId,
    storage,
    storageFactory,
    hold = false,
  }: {
    actorId: string;
    orgId: string;
    storage: SellChargeStorage;
    storageFactory?: () => SellChargeStorage | null;
    hold?: boolean;
  } = $props();

  const sellables: SellCartSellable[] = [
    {
      productId: 'service-a',
      code: 'A',
      name: 'Service A',
      category: null,
      unitPrice: 20,
      active: true,
      kind: 'service',
      itemId: null,
      stockQty: null,
      hasMapping: false,
    },
    {
      productId: 'service-b',
      code: 'B',
      name: 'Service B',
      category: null,
      unitPrice: 30,
      active: true,
      kind: 'service',
      itemId: null,
      stockQty: null,
      hasMapping: false,
    },
  ];
  let lines = $state<CartLine[]>([]);
  let customer = $state<StoredCustomer>({
    partyId: null,
    customerName: null,
    customerPhone: null,
    customerDocNumber: null,
  });
  let activeHandoff = $state<SellChargeClaim | null>(null);
  let pendingPlanId = $state<string | null>(null);
  let handoffNotice = $state('none');

  const session = createSellSessionCoordinator({
    identity: () => ({ actorId, orgId }),
    sellables: () => sellables,
    lines: () => lines,
    replaceLines: (next) => (lines = next),
    customer: () => customer,
    replaceCustomer: (next) => (customer = next),
    holdCartPersistence: () => hold,
    storage: () => (storageFactory ? storageFactory() : storage),
    restoreFailureMessage: () => 'Saved plan cart could not be restored.',
    persistenceFailureMessage: () => 'Cart recovery storage is unavailable.',
    onScopeChanged: () => {
      activeHandoff = null;
      pendingPlanId = null;
      handoffNotice = 'none';
    },
  });

  // Same mount order as /pos/sell: current-scope hydration must complete before
  // the one-time navigation draft can replace the restored register cart.
  $effect(() => {
    const scope = session.scope;
    const hydrated = session.hydrated;
    const currentClaim = activeHandoff;
    if (!hydrated || hold || currentClaim) return;
    untrack(() => {
      const result = session.stageChargeHandoff(scope);
      if (result.status !== 'staged') {
        if (result.status === 'legacy' || result.status === 'invalid') {
          handoffNotice = 'reopen';
        }
        return;
      }
      if (!session.adoptChargeHandoff(result.claim)) return;
      activeHandoff = result.claim;
      lines = result.claim.stage.lines;
      customer = result.claim.stage.customer;
      pendingPlanId = result.claim.stage.pendingPlanId;
    });
  });

  $effect(() => {
    const id = pendingPlanId;
    const account = session.account;
    if (!id || !account) return;
    const detail = account.plans.find(
      (candidate) => candidate.plan.id === id && candidate.plan.status === 'open',
    );
    if (!detail) return;
    const line = sellPlanInstalmentLine(detail);
    if (!line) return;
    lines = [line];
    pendingPlanId = null;
  });

  $effect(() => {
    const claim = activeHandoff;
    const currentLines = lines;
    const currentCustomer = customer;
    if (!claim || hold) return;
    untrack(() => {
      const result = session.finalizeChargeHandoff(claim, currentLines, currentCustomer);
      if (result === 'changed' || result === 'stale') {
        activeHandoff = null;
      } else if (result === 'committed') {
        handoffNotice = claim.stage.notice;
        activeHandoff = null;
      }
    });
  });

  function choosePartyB() {
    customer = {
      partyId: 'party-b',
      customerName: 'Party B',
      customerPhone: null,
      customerDocNumber: null,
    };
  }

  function addServiceB() {
    lines = [
      ...lines,
      {
        sellable: sellables[1]!,
        qty: '1',
        unitPrice: '30',
        discount: '0',
      },
    ];
  }

  function retryProjection() {
    if (customer.partyId) void session.refreshAccount(customer.partyId);
  }
</script>

<p data-testid="scope">{actorId}:{orgId}</p>
<p data-testid="party">{customer.partyId ?? 'none'}</p>
<p data-testid="account">{session.account?.clientKey ?? 'none'}</p>
<p data-testid="account-balance">{session.account?.balance ?? 'none'}</p>
<p data-testid="cart">{lines.map((line) => line.sellable.productId).join(',') || 'empty'}</p>
<p data-testid="hydrated">{session.hydrated ? 'yes' : 'no'}</p>
<p data-testid="handoff">{handoffNotice}</p>
<p data-testid="pending-plan">{pendingPlanId ?? 'none'}</p>
{#if session.cartProjectionPending}<p data-testid="pending">pending</p>{/if}
{#if session.cartProjectionError}
  <div data-testid="projection-error" role="alert">
    {session.cartProjectionError}
    <Button type="button" onclick={retryProjection}>Retry plan projection</Button>
  </div>
{/if}
{#if session.storageError}<p role="alert">{session.storageError}</p>{/if}
<Button type="button" onclick={choosePartyB}>Choose party B</Button>
<Button type="button" onclick={addServiceB}>Add service B</Button>
