<script lang="ts">
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { getActiveHost } from '$lib/state/features/hosts.svelte';
  import { Spinner } from '$lib/components/ui';
  import { AlertTriangle } from 'lucide-svelte';

  const activeHost = $derived(getActiveHost());

  // Only surface when we have a host we're supposed to be connected to, but aren't.
  // A persistent banner (not a toast): the condition lasts until it resolves.
  const show = $derived(!!activeHost && !conn.connected);
  const reconnecting = $derived(conn.connecting);
</script>

{#if show}
  <div
    class="shrink-0 flex items-center gap-2.5 px-4 md:pr-44 py-2 text-xs border-b
      {reconnecting
        ? 'bg-[color-mix(in_srgb,var(--color-warning)_12%,transparent)] border-[color-mix(in_srgb,var(--color-warning)_25%,transparent)] text-warning'
        : 'bg-[color-mix(in_srgb,var(--color-destructive)_12%,transparent)] border-[color-mix(in_srgb,var(--color-destructive)_25%,transparent)] text-destructive'}"
    role="status"
    aria-live="polite"
  >
    {#if reconnecting}
      <Spinner size="xs" class="!text-warning shrink-0" />
      <span class="font-medium">Reconnecting to {activeHost?.name}…</span>
    {:else}
      <AlertTriangle size={14} class="shrink-0" />
      <span class="font-medium">Gateway disconnected</span>
      {#if conn.connectError}
        <span class="text-destructive/80 truncate">· {conn.connectError}</span>
      {:else}
        <span class="text-destructive/80 truncate">· retrying automatically…</span>
      {/if}
    {/if}
  </div>
{/if}
