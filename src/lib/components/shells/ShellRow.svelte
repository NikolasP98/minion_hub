<script lang="ts">
  import type { ShellSummary } from '$lib/services/shells-rpc';

  let { shell, onSelect }: { shell: ShellSummary; onSelect: (shellId: string) => void } = $props();

  function relTime(ms: number | null): string {
    if (!ms) return '—';
    const diff = Date.now() - ms;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  }

  const statusColor = $derived(
    shell.status === 'online'
      ? 'green'
      : shell.status === 'provisioning'
        ? 'amber'
        : shell.status === 'archived'
          ? 'gray'
          : 'red',
  );
</script>

<button class="row" onclick={() => onSelect(shell.shellId)}>
  <span class="status-dot {statusColor}" title={shell.status}></span>
  <span class="name">{shell.displayName}</span>
  <span class="harness">{shell.harness}</span>
  <span class="region">{shell.region}</span>
  <span class="resources">{shell.diskGB}GB · {shell.memoryMB}MB</span>
  <span class="invoke">{relTime(shell.lastInvokeAt)}</span>
  <span class="status-text {statusColor}">{shell.status}</span>
</button>

<style>
  .row {
    display: grid;
    grid-template-columns: auto 1fr 120px 80px 130px 110px 100px;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 12px 16px;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--color-border-default, var(--color-border));
    cursor: pointer;
    text-align: left;
    font-size: 13px;
    color: inherit;
  }
  .row:hover {
    background: var(--color-surface-1, var(--color-bg2));
  }
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .green { background: var(--color-success-fg, var(--color-success)); }
  .amber { background: var(--color-warning-fg, var(--color-warning)); }
  .gray { background: var(--color-text-disabled, var(--color-muted)); }
  .red { background: var(--color-danger-fg, var(--color-destructive)); }
  .name {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .harness, .region, .resources, .invoke {
    color: var(--color-text-tertiary, var(--color-muted-foreground));
    font-variant-numeric: tabular-nums;
  }
  .status-text {
    text-align: right;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 11px;
    font-weight: 600;
  }
  .status-text.green { color: var(--color-success-fg, var(--color-success)); background: transparent; }
  .status-text.amber { color: var(--color-warning-fg, var(--color-warning)); background: transparent; }
  .status-text.gray { color: var(--color-text-tertiary, var(--color-muted)); background: transparent; }
  .status-text.red { color: var(--color-danger-fg, var(--color-destructive)); background: transparent; }
  @media (max-width: 767.98px) {
    .row {
      grid-template-columns: auto minmax(0, 1fr) auto;
      grid-template-areas:
        'dot name status'
        'dot harness status'
        'dot resources invoke';
      gap: var(--space-1, 4px) var(--space-2, 8px);
      min-height: var(--control-height-touch, 44px);
      margin-bottom: var(--space-2, 8px);
      padding: var(--space-3, 12px);
      border: 1px solid var(--color-border-default, var(--color-border));
      border-radius: var(--radius-lg);
      background: var(--color-surface-2, var(--color-bg2));
    }
    .status-dot { grid-area: dot; }
    .name { grid-area: name; }
    .harness { grid-area: harness; }
    .resources { grid-area: resources; }
    .invoke { grid-area: invoke; justify-self: end; }
    .status-text { grid-area: status; align-self: start; }
    .region { display: none; }
  }
</style>
