<script lang="ts">
  import type { ShellsQuota } from '$lib/services/shells-rpc';

  let { quota }: { quota: ShellsQuota | null } = $props();

  function tone(used: number, limit: number, amber: number, red: number): 'green' | 'amber' | 'red' {
    if (used >= red) return 'red';
    if (used >= amber) return 'amber';
    return 'green';
  }

  const shellsTone = $derived(quota ? tone(quota.shells.used, quota.shells.limit, 40, 50) : 'green');
  const diskTone = $derived(quota ? tone(quota.diskGB.used, quota.diskGB.limit, 20, 22) : 'green');
  const shelleyTone = $derived(
    quota ? tone(quota.shelleyUSD.used, quota.shelleyUSD.limit, 16, 19) : 'green',
  );
</script>

<div class="strip">
  <div class="pill {shellsTone}">
    <span class="label">Shells</span>
    <span class="value">{quota?.shells.used ?? '—'} / {quota?.shells.limit ?? 50}</span>
  </div>
  <div class="pill {diskTone}">
    <span class="label">Disk</span>
    <span class="value">
      {quota ? `${quota.diskGB.used.toFixed(1)} GB` : '—'} / {quota?.diskGB.limit ?? 25} GB
    </span>
  </div>
  <div class="pill {shelleyTone}">
    <span class="label">Shelley</span>
    <span class="value">
      ${quota ? quota.shelleyUSD.used.toFixed(2) : '—'} / ${quota?.shelleyUSD.limit ?? 20}
    </span>
  </div>
</div>

<style>
  .strip {
    display: flex;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--color-border, #e5e7eb);
    background: var(--color-surface-soft, #fafafa);
  }
  .pill {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 999px;
    border: 1px solid;
    font-size: 13px;
  }
  .label {
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 11px;
    opacity: 0.7;
  }
  .value {
    font-variant-numeric: tabular-nums;
  }
  .green {
    border-color: rgba(34, 197, 94, 0.4);
    background: rgba(34, 197, 94, 0.06);
  }
  .amber {
    border-color: rgba(245, 158, 11, 0.5);
    background: rgba(245, 158, 11, 0.08);
  }
  .red {
    border-color: rgba(239, 68, 68, 0.6);
    background: rgba(239, 68, 68, 0.1);
    color: rgb(185, 28, 28);
  }
</style>
