<script lang="ts">
  import { gw } from '$lib/state/gateway-data.svelte';
  import { conn } from '$lib/state/connection.svelte';
  import { fmtUptime } from '$lib/utils/format';
  import { onMount } from 'svelte';

  let uptimeTick = $state(0);

  onMount(() => {
    const t = setInterval(() => { uptimeTick++; }, 10000);
    return () => clearInterval(t);
  });

  const uptimeMs = $derived.by(() => {
    if (!gw.hello || !conn.connectedAt) return null;
    return (gw.hello.snapshot?.uptimeMs ?? 0) + (Date.now() - conn.connectedAt);
  });

  const deviceCount = $derived(gw.presence.length);
  const channels = $derived(gw.channels as { active?: number } | null);
  const cronJobs = $derived(gw.cronJobs as Array<{ id?: string; status?: string }> | null);
</script>

{#if conn.connected && gw.hello}
  <div class="gw-info">
    {#if gw.hello.server.version}
      <span class="gw-tag">{gw.hello.server.version}</span>
    {/if}
    {#if uptimeMs !== null}
      <span class="gw-tag ok">{fmtUptime(uptimeMs)}</span>
    {/if}
    {#if deviceCount > 0}
      <span class="gw-tag">{deviceCount} device{deviceCount !== 1 ? 's' : ''}</span>
    {/if}
    {#if channels?.active}
      <span class="gw-tag">{channels.active} ch</span>
    {/if}
    {#if cronJobs?.length}
      <span class="gw-tag">{cronJobs.length} cron</span>
    {/if}
  </div>
{/if}

<style>
  .gw-info {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text2);
  }
  .gw-tag {
    background: var(--bg3);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 11px;
    white-space: nowrap;
  }
  .gw-tag.ok { border-color: var(--green); color: var(--green); }
</style>
