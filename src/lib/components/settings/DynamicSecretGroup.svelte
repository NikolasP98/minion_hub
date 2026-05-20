<script lang="ts">
  import type { SecretsSummary } from '$lib/types/secrets';
  import SecretStatusPill from './SecretStatusPill.svelte';

  interface Props {
    groupKey: string;
    label: string;
    scopeLabel: string;
    ownerPlugin: string;
    instances: SecretsSummary[];
    onRotate: (instanceId: string) => void;
    onClear: (instanceId: string) => Promise<void>;
    onProbe: (instanceId: string) => Promise<void>;
  }

  let { groupKey, label, scopeLabel, ownerPlugin, instances, onRotate, onClear, onProbe }: Props =
    $props();

  let busy = $state<Record<string, 'probe' | 'clear' | null>>({});

  function fmtTime(t: number | null): string {
    if (!t) return 'never';
    const d = new Date(t);
    return d.toLocaleString();
  }

  async function handleClear(instanceId: string) {
    if (!confirm(`Clear secret for ${instanceId}?`)) return;
    busy[instanceId] = 'clear';
    try {
      await onClear(instanceId);
    } finally {
      busy[instanceId] = null;
    }
  }

  async function handleProbe(instanceId: string) {
    busy[instanceId] = 'probe';
    try {
      await onProbe(instanceId);
    } finally {
      busy[instanceId] = null;
    }
  }
</script>

<div class="bg-card border border-border rounded-lg overflow-hidden">
  <header class="px-5 py-3 border-b border-border flex items-center justify-between gap-3">
    <div class="min-w-0">
      <h3 class="text-sm font-semibold text-foreground truncate">{label}</h3>
      <p class="text-[11px] text-muted-foreground mt-0.5">
        <span class="font-mono">{groupKey}</span>
        <span class="mx-1.5 opacity-50">·</span>
        {scopeLabel}
        <span class="mx-1.5 opacity-50">·</span>
        {instances.length}
        {instances.length === 1 ? 'instance' : 'instances'}
      </p>
    </div>
    <a
      href={`/settings/plugins?plugin=${encodeURIComponent(ownerPlugin)}`}
      class="text-[11px] text-accent hover:underline whitespace-nowrap"
    >
      Manage {ownerPlugin} →
    </a>
  </header>

  {#if instances.length === 0}
    <div class="px-5 py-6 text-center">
      <p class="text-xs text-muted-foreground">
        No instances yet. Add accounts in the {ownerPlugin} plugin to create entries here.
      </p>
    </div>
  {:else}
    <ul class="divide-y divide-border">
      {#each instances as inst (inst.rowKey)}
        <li class="px-5 py-3 flex items-center gap-3">
          <div class="flex-1 min-w-0">
            <p class="text-xs font-mono text-foreground truncate">{inst.instanceId}</p>
            <p class="text-[10px] text-muted-foreground mt-0.5">
              Last checked: {fmtTime(inst.lastProbeAt)}
            </p>
          </div>
          <SecretStatusPill status={inst.probeStatus} message={inst.probeMessage} />
          <div class="flex items-center gap-1">
            <button
              type="button"
              class="text-[11px] text-muted-foreground hover:text-foreground border border-border rounded-[5px] px-2 py-1 transition-colors disabled:opacity-50"
              disabled={busy[inst.instanceId!] === 'probe'}
              onclick={() => handleProbe(inst.instanceId!)}
              title="Re-probe this credential"
            >
              {busy[inst.instanceId!] === 'probe' ? '…' : 'Probe'}
            </button>
            <button
              type="button"
              class="text-[11px] text-accent hover:brightness-115 border border-accent/30 rounded-[5px] px-2 py-1 transition-colors"
              onclick={() => onRotate(inst.instanceId!)}
              title="Set a new value"
            >
              Rotate
            </button>
            <button
              type="button"
              class="text-[11px] text-rose-300 hover:text-rose-200 border border-rose-500/30 rounded-[5px] px-2 py-1 transition-colors disabled:opacity-50"
              disabled={busy[inst.instanceId!] === 'clear'}
              onclick={() => handleClear(inst.instanceId!)}
              title="Clear this credential"
            >
              {busy[inst.instanceId!] === 'clear' ? '…' : 'Clear'}
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>
