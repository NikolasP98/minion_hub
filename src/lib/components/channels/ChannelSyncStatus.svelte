<script lang="ts">
  /**
   * WhatsApp full-sync has two independent pipelines:
   *   1. phone -> gateway (Baileys history events)
   *   2. gateway outbox -> Hub (per-row ingest acknowledgements)
   *
   * Never use stage 1 as evidence for stage 2. The delivery bar below is
   * driven only by rows the Hub explicitly acknowledged.
   */
  import type { ChannelHistorySync, ChannelHubSync } from '$lib/types/channels';
  import { refreshChannelStatus } from '$lib/services/gateway-rpc';
  import { ProgressBar, Spinner, iconSizes } from '$lib/components/ui';
  import { PauseCircle, RefreshCw, CircleCheck, Smartphone, Database } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';

  interface Props {
    sync: ChannelHistorySync | undefined;
    delivery?: ChannelHubSync;
    compact?: boolean;
    /** Accepted for caller compatibility; delivery is account-scoped by the gateway. */
    serverId?: string;
    accountId?: string | null;
  }
  let { sync, delivery, compact = false, accountId }: Props = $props();

  const PHASE_LABELS: Record<ChannelHistorySync['phase'], () => string> = {
    idle: m.channelSync_phaseIdle,
    bootstrap: m.channelSync_phaseBootstrap,
    recent: m.channelSync_phaseRecent,
    full: m.channelSync_phaseFull,
    'on-demand': m.channelSync_phaseOnDemand,
    complete: m.channelSync_phaseComplete,
    stalled: m.channelSync_phaseStalled,
  };

  const phase = $derived(sync?.phase ?? 'idle');
  const collectionStalled = $derived(phase === 'stalled');
  const collectionDone = $derived(phase === 'complete');
  const inferred = $derived(collectionDone && sync?.explicit === false);
  const deliveryActive = $derived((delivery?.pending ?? 0) > 0);
  const deliveryDone = $derived((delivery?.total ?? 0) > 0 && delivery?.pending === 0);
  const collectionLabel = $derived(
    inferred ? m.channelSync_phaseCompleteInferred() : PHASE_LABELS[phase](),
  );
  // Baileys silence is not a delivery pause. If the durable outbox still has
  // work, lead with the operation that is actually progressing.
  const label = $derived(
    deliveryActive
      ? m.channelSync_uploadingToHub()
      : deliveryDone
        ? m.channelSync_uploadComplete()
        : collectionLabel,
  );
  const counts = $derived(
    m.channelSync_counts({
      messages: (sync?.messages ?? 0).toLocaleString(),
      chats: (sync?.chats ?? 0).toLocaleString(),
    }),
  );
  const deliveryDetail = $derived(
    delivery
      ? m.channelSync_uploadCount({
          acknowledged: delivery.acknowledged.toLocaleString(),
          total: delivery.total.toLocaleString(),
        })
      : '',
  );
  const pendingDetail = $derived(
    delivery
      ? delivery.retrying > 0
        ? m.channelSync_uploadPendingRetrying({
            pending: delivery.pending.toLocaleString(),
            retrying: delivery.retrying.toLocaleString(),
          })
        : m.channelSync_uploadPending({ pending: delivery.pending.toLocaleString() })
      : '',
  );
  const deliveryProgress = $derived(
    delivery && delivery.total > 0 ? (delivery.acknowledged / delivery.total) * 100 : null,
  );
  const Icon = $derived(
    deliveryActive
      ? RefreshCw
      : deliveryDone || collectionDone
        ? CircleCheck
        : collectionStalled
          ? PauseCircle
          : RefreshCw,
  );
  const tone = $derived(
    deliveryActive
      ? 'accent'
      : deliveryDone || collectionDone
        ? 'success'
        : collectionStalled
          ? 'warning'
          : 'accent',
  );
  const hasSync = $derived(!!sync && phase !== 'idle');
  const waitingForDelivery = $derived(!!accountId && hasSync && !delivery);

  // channels.status is event-driven for channel lifecycle changes, whereas
  // the outbox drains every ten seconds. Poll the existing RPC while work is
  // visible so acknowledged/pending counts advance without inventing a
  // second status endpoint.
  $effect(() => {
    const account = accountId;
    const shouldPoll =
      !!account && (deliveryActive || waitingForDelivery || (!collectionDone && phase !== 'idle'));
    if (!shouldPoll) return;

    let cancelled = false;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        if (!cancelled) await refreshChannelStatus();
      } catch {
        // A reconnect can briefly reject requests. Keep the last exact
        // counters visible and let the next interval retry.
      } finally {
        inFlight = false;
      }
    };

    void refresh();
    const timer = setInterval(() => void refresh(), 5_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  });
</script>

{#if compact}
  {#if hasSync || delivery}
    <div class="flex flex-col gap-1.5">
      <div class="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
        <Icon
          size={iconSizes.xs}
          class="shrink-0 {tone === 'warning'
            ? 'text-warning'
            : tone === 'success'
              ? 'text-success'
              : 'text-accent'}"
        />
        <span class="truncate {tone === 'warning' ? 'text-warning' : ''}">{label}</span>
        {#if hasSync}
          <span class="ml-auto shrink-0 tabular-nums">{counts}</span>
        {/if}
      </div>
      {#if hasSync && !collectionDone}
        <ProgressBar
          value={sync?.progress ?? null}
          label={m.channelSync_receivedFromWhatsApp()}
          size="sm"
        />
      {/if}
      {#if delivery}
        <ProgressBar
          value={deliveryProgress}
          label={deliveryDone ? m.channelSync_uploadComplete() : m.channelSync_uploadingToHub()}
          detail={deliveryDetail}
          size="sm"
        />
        {#if deliveryActive}
          <p class="text-xs text-muted-foreground tabular-nums">{pendingDetail}</p>
        {/if}
      {:else if waitingForDelivery}
        <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Database size={iconSizes.xs} class="shrink-0" />
          <Spinner size="xs" label={m.channelSync_waitingForGatewayStatus()} />
        </div>
      {/if}
    </div>
  {/if}
{:else if !sync && !delivery}
  <p class="text-xs text-muted-foreground">{m.channelSync_noInfo()}</p>
{:else}
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-2 text-sm">
      <Icon
        size={iconSizes.sm}
        class="shrink-0 {tone === 'warning'
          ? 'text-warning'
          : tone === 'success'
            ? 'text-success'
            : 'text-accent'}"
      />
      <span class="font-medium text-foreground">{label}</span>
    </div>

    {#if hasSync}
      <ProgressBar
        value={collectionDone ? 100 : (sync?.progress ?? null)}
        label={m.channelSync_receivedFromWhatsApp()}
        detail={counts}
        size="md"
      />
    {/if}

    {#if delivery}
      <div class="flex flex-col gap-1.5 rounded-md border border-border bg-bg2 p-2.5">
        <div class="flex items-center gap-2 text-xs">
          <Database
            size={iconSizes.sm}
            class="shrink-0 {deliveryDone ? 'text-success' : 'text-accent'}"
          />
          <span class="font-medium text-foreground">
            {deliveryDone ? m.channelSync_uploadComplete() : m.channelSync_uploadingToHub()}
          </span>
        </div>
        <ProgressBar
          value={deliveryProgress}
          label={m.channelSync_acknowledgedByHub()}
          detail={deliveryDetail}
          size="md"
        />
        {#if deliveryActive}
          <p class="text-xs text-muted-foreground tabular-nums">{pendingDetail}</p>
        {/if}
        <p class="text-xs text-muted-foreground">{m.channelSync_acknowledgedHint()}</p>
      </div>
    {:else if waitingForDelivery}
      <div
        class="flex items-center gap-2 rounded-md border border-border bg-bg2 p-2.5 text-xs text-muted-foreground"
      >
        <Database size={iconSizes.sm} class="shrink-0" />
        <Spinner size="xs" label={m.channelSync_waitingForGatewayStatus()} />
      </div>
    {/if}

    {#if collectionStalled && !deliveryActive && !deliveryDone}
      <div
        class="flex items-start gap-2 p-2.5 rounded-md bg-warning/15 text-warning border border-warning/30"
      >
        <Smartphone size={iconSizes.sm} class="shrink-0 mt-0.5" />
        <p class="text-xs">{m.channelSync_stalledHelp()}</p>
      </div>
    {:else if !collectionDone && !collectionStalled}
      <p class="text-xs text-muted-foreground">{m.channelSync_keepPhoneOpen()}</p>
    {/if}
    <p class="text-xs text-muted-strong">{m.channelSync_sessionOnly()}</p>
  </div>
{/if}
