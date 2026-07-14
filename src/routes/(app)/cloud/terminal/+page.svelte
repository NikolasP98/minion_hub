<script lang="ts">
  import { page } from '$app/state';
  import RemoteTerminal from '$lib/components/cloud/RemoteTerminal.svelte';
  import { cloudShell, cloudState, refreshCloud } from '$lib/state/features/cloud.svelte';
  import {
    AsyncBoundary,
    PageBody,
    PageShell,
    type AsyncBoundaryState,
  } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';

  const selected = $derived(cloudShell(page.url.searchParams.get('server')));
  const pageState = $derived.by<AsyncBoundaryState>(() => {
    if (cloudState.loading) return { kind: 'loading', label: m.common_loading() };
    if (cloudState.error && cloudState.shells.length === 0) {
      return {
        kind: 'error',
        title: m.cloud_load_failed(),
        description: cloudState.error,
        retry: () => void refreshCloud(),
      };
    }
    if (!selected) {
      return {
        kind: 'empty',
        title: m.cloud_empty_title(),
        description: m.cloud_empty_description(),
      };
    }
    return { kind: 'ready' };
  });
</script>

<svelte:head><title>{m.cloud_terminal_title()} · Minion hub</title></svelte:head>

<PageShell archetype="terminal" scroll="none" variant="terminal" labelledBy="cloud-terminal-title">
  <h1 id="cloud-terminal-title" class="sr-only">{m.cloud_terminal_title()}</h1>
  <PageBody padding="compact" scroll="none" class="cloud-remote-body">
    <AsyncBoundary state={pageState} class="cloud-remote-boundary">
      {#if selected}
        <div class="remote-frame">
          <RemoteTerminal shell={selected} />
        </div>
      {/if}
    </AsyncBoundary>
  </PageBody>
</PageShell>

<style>
  :global(.cloud-remote-body),
  :global(.cloud-remote-boundary),
  .remote-frame {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex: 1;
  }

  :global(.cloud-remote-body) {
    background: color-mix(in srgb, var(--color-canvas) 90%, var(--color-accent));
  }

  .remote-frame {
    overflow: hidden;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
  }

  @media (max-width: 767.98px) {
    :global(.cloud-remote-body) {
      padding: var(--space-2);
    }
  }
</style>
