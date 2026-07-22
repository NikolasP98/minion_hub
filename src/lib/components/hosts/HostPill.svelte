<script lang="ts">
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { isAdmin } from '$lib/state/features/user.svelte';

  // Compatibility shim for the two layout callers. Build-channel selection now
  // lives in the admin-only ProfileMenu; the mobile header keeps only its small
  // connection-status dot, while DynamicIsland already owns that indicator.
  let { align: _align = 'left', dot = true }: { align?: 'left' | 'right'; dot?: boolean } =
    $props();

  const dotClass = $derived(
    conn.connected
      ? 'bg-success shadow-[var(--shadow-status-glow)]'
      : conn.connecting
        ? 'bg-warning shadow-[var(--shadow-status-glow)] animate-pulse'
        : 'bg-destructive shadow-[var(--shadow-status-glow)] animate-pulse',
  );
</script>

{#if isAdmin.value && dot}
  <span class="dot {dotClass}" aria-hidden="true"></span>
{/if}

<style>
  .dot {
    display: block;
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    transition: background-color var(--duration-fast) var(--ease-standard);
  }
</style>
