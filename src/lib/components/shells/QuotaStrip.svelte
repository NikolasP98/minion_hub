<script lang="ts">
  import type { ShellsQuota } from '$lib/services/shells-rpc';

  let { quota }: { quota: ShellsQuota | null } = $props();

  function tone(
    used: number,
    limit: number,
    amber: number,
    red: number,
  ): 'green' | 'amber' | 'red' {
    if (used >= red) return 'red';
    if (used >= amber) return 'amber';
    return 'green';
  }

  const shellsTone = $derived(
    quota ? tone(quota.shells.used, quota.shells.limit, 40, 50) : 'green',
  );
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
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border-default, var(--color-border));
    background: var(--color-surface-1, var(--color-bg2));
    overflow-x: auto;
    overscroll-behavior-inline: contain;
  }
  .pill {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-full);
    border: 1px solid;
    font-size: var(--font-size-body);
  }
  .label {
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: var(--font-size-caption);
    opacity: 0.7;
  }
  .value {
    font-variant-numeric: tabular-nums;
  }
  .green {
    border-color: var(--color-success-border, var(--color-success));
    background: var(--color-success-surface, transparent);
  }
  .amber {
    border-color: var(--color-warning-border, var(--color-warning));
    background: var(--color-warning-surface, transparent);
  }
  .red {
    border-color: var(--color-danger-border, var(--color-destructive));
    background: var(--color-danger-surface, transparent);
    color: var(--color-danger-fg, var(--color-destructive));
  }
  @media (max-width: 767.98px) {
    .strip {
      padding-inline: var(--space-page-gutter, 16px);
    }
    .pill {
      flex: none;
      min-height: var(--control-height-touch, 44px);
    }
  }
</style>
