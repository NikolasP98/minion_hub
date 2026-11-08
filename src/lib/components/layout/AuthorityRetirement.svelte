<script lang="ts">
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import { Button } from '@minion-stack/ui';
  import { retryAuthorityNavigation } from '$lib/services/role-simulation-client';
  import * as m from '$lib/paraglide/messages';

  let { active }: { active: boolean } = $props();

  function refresh() {
    try {
      if (!retryAuthorityNavigation()) window.location.reload();
    } catch {
      // Keep the read-only recovery available if navigation is blocked again.
    }
  }
</script>

{#if active}
  <div class="authority-recovery" data-authority-recovery>
    <EmptyState title={m.roleSimulation_refreshRequired()} compact>
      {#snippet action()}
        <Button size="touch" variant="primary" onclick={refresh}>
          {m.roleSimulation_refresh()}
        </Button>
      {/snippet}
    </EmptyState>
  </div>
{/if}

<style>
  /* Portalled menus and native overlays can sit outside AppViewport. Conceal
     the old document together, leaving only safe document-read recovery. */
  :global(html[data-authority-retiring] body *) {
    visibility: hidden !important;
  }
  :global(html[data-authority-retiring] body .authority-recovery),
  :global(html[data-authority-retiring] body .authority-recovery *),
  :global(html[data-authority-retiring] body [data-role-simulation-frame]) {
    visibility: visible !important;
  }
  .authority-recovery {
    position: fixed;
    inset: 0;
    z-index: var(--layer-command);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-page-gutter);
    background: var(--color-canvas);
  }
</style>
