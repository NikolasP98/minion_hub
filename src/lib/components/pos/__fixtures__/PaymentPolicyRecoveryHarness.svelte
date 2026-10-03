<script lang="ts">
  import {
    createPaymentPolicyRecovery,
    repairCommittedTicketView,
    runPaymentPolicyTicketAttempt,
  } from '../payment-policy-recovery.svelte';
  import { submitPosTicket } from '../pos-ticket-transport';
  import { Button } from '$lib/components/ui';

  let {
    actorId,
    orgId,
    revision,
    reload,
    fetcher,
    postCommitRefreshes = [],
    onPostCommitReady = () => undefined,
  }: {
    actorId: string;
    orgId: string;
    revision: string;
    reload: () => Promise<void>;
    fetcher: typeof fetch;
    postCommitRefreshes?: readonly (() => Promise<void>)[];
    onPostCommitReady?: () => void;
  } = $props();

  let cart = $state('Service A');
  let tender = $state('10.00');
  let committed = $state(false);
  let lastAttempt = $state('none');
  let committedReceipt = $state('none');
  let repairStatus = $state('none');
  let refreshFailed = $state(false);

  const recovery = createPaymentPolicyRecovery({
    owner: () => ({ actorId, orgId }),
    revision: () => revision,
    reload: () => reload(),
  });

  async function finish() {
    if (recovery.submitting || recovery.blocksFinish) return;
    const attemptRevision = revision;
    const result = await runPaymentPolicyTicketAttempt({
      recovery,
      paymentPolicyRevision: attemptRevision,
      submit: () =>
        submitPosTicket({
          fetcher,
          paymentPolicyRevision: attemptRevision,
          request: {
            lines: [
              {
                kind: 'service',
                finProductId: 'service-a',
                bookingId: null,
                description: cart,
                qty: 1,
                unitPrice: 10,
                discount: 0,
                planId: null,
                redemptionId: null,
              },
            ],
            payments: [{ method: 'cash', amount: 10, tendered: 10 }],
            partyId: null,
            customerName: null,
            allowNegativeStock: false,
          },
        }),
    });
    lastAttempt = result.status;
    if (result.status === 'committed') {
      committed = true;
      committedReceipt = result.value.ticket.id;
      const repair = await repairCommittedTicketView({
        owner: result.owner,
        refreshes: postCommitRefreshes,
        onCommittedRefreshFailure: () => (refreshFailed = true),
        onReady: onPostCommitReady,
      });
      repairStatus = repair.status;
    } else if (result.status === 'committed-stale') {
      committedReceipt = result.value.ticket.id;
    }
  }
</script>

<p data-testid="owner">{actorId}:{orgId}</p>
<p data-testid="cart">{cart}</p>
<p data-testid="tender">{tender}</p>
<p data-testid="policy-state">{recovery.state}</p>
<p data-testid="last-attempt">{lastAttempt}</p>
<p data-testid="committed-receipt">{committedReceipt}</p>
<p data-testid="repair-status">{repairStatus}</p>
{#if committed}<p role="status">Ticket committed</p>{/if}
{#if refreshFailed}<p role="alert">Sale committed; refresh failed. Do not submit again.</p>{/if}
{#if recovery.state !== 'idle'}
  <p role={recovery.state === 'loading' ? 'status' : 'alert'}>
    {recovery.state === 'loading'
      ? 'Refreshing payment policy'
      : recovery.state === 'failed'
        ? 'Payment policy reload failed'
        : 'Review payment policy'}
  </p>
{/if}
{#if recovery.state === 'failed'}
  <Button type="button" onclick={() => recovery.retry()}>Retry policy</Button>
{/if}
<Button type="button" onclick={finish} disabled={recovery.submitting || recovery.blocksFinish}>
  Finish sale
</Button>
