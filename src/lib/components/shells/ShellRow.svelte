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
    border-bottom: 1px solid var(--color-border, #e5e7eb);
    cursor: pointer;
    text-align: left;
    font-size: 13px;
    color: inherit;
  }
  .row:hover {
    background: var(--color-surface-soft, #fafafa);
  }
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .green { background: rgb(34, 197, 94); }
  .amber { background: rgb(245, 158, 11); }
  .gray { background: rgb(156, 163, 175); }
  .red { background: rgb(239, 68, 68); }
  .name {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .harness, .region, .resources, .invoke {
    color: var(--color-text-muted, #6b7280);
    font-variant-numeric: tabular-nums;
  }
  .status-text {
    text-align: right;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 11px;
    font-weight: 600;
  }
  .status-text.green { color: rgb(22, 163, 74); background: transparent; }
  .status-text.amber { color: rgb(180, 83, 9); background: transparent; }
  .status-text.gray { color: rgb(75, 85, 99); background: transparent; }
  .status-text.red { color: rgb(185, 28, 28); background: transparent; }
</style>
