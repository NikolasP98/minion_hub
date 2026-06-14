<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import type { SecretsSummary } from '$lib/types/secrets';
  import { Button } from '$lib/components/ui';
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
    if (!confirm(m.dynamicSecretGroup_clearConfirm({ id: instanceId }))) return;
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

<div class="surface-2 rounded-lg overflow-hidden">
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
      {m.dynamicSecretGroup_manage({ plugin: ownerPlugin })} →
    </a>
  </header>

  {#if instances.length === 0}
    <div class="px-5 py-6 text-center">
      <p class="text-xs text-muted-foreground">
        {m.dynamicSecretGroup_noInstances({ plugin: ownerPlugin })}
      </p>
    </div>
  {:else}
    <ul class="divide-y divide-border">
      {#each instances as inst (inst.rowKey)}
        <li class="px-5 py-3 flex items-center gap-3">
          <div class="flex-1 min-w-0">
            <p class="text-xs font-mono text-foreground truncate">{inst.instanceId}</p>
            <p class="text-[10px] text-muted-foreground mt-0.5">
              {m.dynamicSecretGroup_lastChecked()}: {fmtTime(inst.lastProbeAt)}
            </p>
          </div>
          <SecretStatusPill status={inst.probeStatus} message={inst.probeMessage} />
          <div class="flex items-center gap-1">
            <Button
              variant="secondary"
              size="sm"
              loading={busy[inst.instanceId!] === 'probe'}
              onclick={() => handleProbe(inst.instanceId!)}
              title={m.dynamicSecretGroup_probeTitle()}
            >
              {m.dynamicSecretGroup_probe()}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onclick={() => onRotate(inst.instanceId!)}
              title={m.dynamicSecretGroup_rotateTitle()}
            >
              {m.dynamicSecretGroup_rotate()}
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={busy[inst.instanceId!] === 'clear'}
              onclick={() => handleClear(inst.instanceId!)}
              title={m.dynamicSecretGroup_clearTitle()}
            >
              {m.common_delete()}
            </Button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>
