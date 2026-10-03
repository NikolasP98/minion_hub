<script lang="ts">
  import { Button, iconSizes } from '$lib/components/ui';
  import { PublicTaskShell } from '$lib/components/ui/foundations';
  import { Clock3 } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import type { OwnPendingRequests } from '$server/services/join/pending.repository';

  let {
    pending,
    onrefresh,
  }: {
    pending: OwnPendingRequests;
    onrefresh: () => Promise<void>;
  } = $props();
  let refreshing = $state(false);
  let refreshFailed = $state(false);
  const title = $derived(
    pending.kind === 'none'
      ? m.join_pendingNoneTitle()
      : pending.kind === 'one'
        ? m.join_pendingOneTitle()
        : m.join_pendingManyTitle(),
  );

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    refreshFailed = false;
    try {
      await onrefresh();
    } catch {
      refreshFailed = true;
    } finally {
      refreshing = false;
    }
  }
</script>

{#snippet taskIcon()}<Clock3 size={iconSizes.lg} />{/snippet}
<PublicTaskShell
  eyebrow={m.join_pendingEyebrow()}
  {title}
  description={m.join_pendingDescription()}
  icon={taskIcon}
>
  <div class="flex flex-col gap-4">
    {#if pending.kind === 'none'}
      <p class="text-sm text-muted-foreground" role="status">{m.join_pendingEmpty()}</p>
      <Button href="/join" variant="primary" size="touch" class="self-start"
        >{m.join_pendingRequest()}</Button
      >
    {:else}
      <ul class="flex flex-col gap-3" aria-label={title}>
        {#each pending.requests as request (request.id)}
          <li class="min-w-0 rounded-[var(--radius-md)] border border-border bg-bg2 px-4 py-3">
            <p class="break-words text-sm font-semibold text-foreground">
              {request.organizationName}
            </p>
            <p class="mt-1 text-xs text-muted-foreground">{m.join_pendingStatus()}</p>
          </li>
        {/each}
      </ul>
      {#if pending.hasMore}<p class="text-sm text-muted-foreground">{m.join_pendingMore()}</p>{/if}
    {/if}
    <Button
      variant="outline"
      size="touch"
      class="self-start"
      loading={refreshing}
      onclick={refresh}
    >
      {m.join_pendingRefresh()}
    </Button>
    {#if refreshFailed}<p class="text-sm text-destructive" role="alert">
        {m.join_pendingRefreshFailed()}
      </p>{/if}
  </div>
</PublicTaskShell>
