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
  <div class="flex items-center gap-[6px] text-xs text-muted">
    {#if gw.hello.server.version}
      <span class="bg-bg3 border border-border rounded-sm py-[2px] px-2 text-[11px] whitespace-nowrap">{gw.hello.server.version}</span>
    {/if}
    {#if uptimeMs !== null}
      <span class="bg-bg3 border border-success rounded-sm py-[2px] px-2 text-[11px] whitespace-nowrap text-success">{fmtUptime(uptimeMs)}</span>
    {/if}
    {#if deviceCount > 0}
      <span class="bg-bg3 border border-border rounded-sm py-[2px] px-2 text-[11px] whitespace-nowrap">{deviceCount} device{deviceCount !== 1 ? 's' : ''}</span>
    {/if}
    {#if channels?.active}
      <span class="bg-bg3 border border-border rounded-sm py-[2px] px-2 text-[11px] whitespace-nowrap">{channels.active} ch</span>
    {/if}
    {#if cronJobs?.length}
      <span class="bg-bg3 border border-border rounded-sm py-[2px] px-2 text-[11px] whitespace-nowrap">{cronJobs.length} cron</span>
    {/if}
  </div>
{/if}
