<script lang="ts">
  import { Button } from '$lib/components/ui';
import type { VariableSpec } from '$lib/flows/master-flows';
  import { resolveFlowVariables } from '$lib/flows/flow-variables';
  import * as m from '$lib/paraglide/messages';

  interface Props {
    flowId: string;
    specs: VariableSpec[];
    toggles: Record<string, boolean>;
    canEdit: boolean;
  }

  let { flowId, specs, toggles, canEdit }: Props = $props();

  // Optimistic local toggle state — seeded from the prop once.
  // svelte-ignore state_referenced_locally
  let localToggles = $state<Record<string, boolean>>({ ...toggles });

  let resolved = $derived(resolveFlowVariables(specs, localToggles));

  const TYPE_LABELS: Record<string, string> = {
    int: 'int',
    float: 'float',
    string: 'str',
    bool: 'bool',
    list: 'list',
    object: 'obj',
  };

  async function toggle(varKey: string, current: boolean) {
    const next = !current;
    // Optimistic update.
    localToggles = { ...localToggles, [varKey]: next };
    try {
      const res = await fetch(`/api/flows/${flowId}/exports`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ varKey, enabled: next }),
      });
      if (!res.ok) {
        // Revert on failure.
        localToggles = { ...localToggles, [varKey]: current };
      }
    } catch {
      localToggles = { ...localToggles, [varKey]: current };
    }
  }
</script>

<div class="flow-exports">
  <p class="flow-exports__label">{m.flow_exports_label()}</p>

  {#if resolved.length === 0}
    <p class="flow-exports__empty">{m.flow_exports_none()}</p>
  {:else}
    <ul class="flow-exports__list">
      {#each resolved as v (v.key)}
        <li class="flow-exports__item">
          <span class="flow-exports__var-label">{v.label}</span>
          <span class="flow-exports__var-key">{v.key}</span>
          <span class="flow-exports__type-chip">{TYPE_LABELS[v.type] ?? v.type}</span>
          <Button variant="ghost"
            role="switch"
            aria-checked={v.enabled}
            disabled={!canEdit}
            class={`flow-exports__toggle${v.enabled ? ' flow-exports__toggle--on' : ''}`}
            onclick={() => { if (canEdit) toggle(v.key, v.enabled); }}
            title={v.description ?? v.label}
          >
            <span class="flow-exports__toggle-thumb"></span>
          </Button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .flow-exports {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    min-width: 260px;
  }

  .flow-exports__label {
    font-size: var(--font-size-caption);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-tertiary, color-mix(in srgb, var(--color-text-primary) 40%, transparent));
    margin: 0 0 var(--space-1);
  }

  .flow-exports__empty {
    font-size: var(--font-size-caption);
    color: var(--color-text-tertiary, color-mix(in srgb, var(--color-text-primary) 35%, transparent));
    margin: 0;
  }

  .flow-exports__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .flow-exports__item {
    display: grid;
    grid-template-columns: 1fr auto auto auto;
    align-items: center;
    gap: var(--space-2);
  }

  .flow-exports__var-label {
    font-size: var(--font-size-caption);
    color: var(--color-text-primary, color-mix(in srgb, var(--color-text-primary) 85%, transparent));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .flow-exports__var-key {
    font-size: var(--font-size-telemetry);
    font-family: var(--font-mono, monospace);
    color: var(--color-text-tertiary, color-mix(in srgb, var(--color-text-primary) 40%, transparent));
  }

  .flow-exports__type-chip {
    font-size: var(--font-size-telemetry);
    font-family: var(--font-mono, monospace);
    background: var(--color-surface-2, color-mix(in srgb, var(--color-text-primary) 8%, transparent));
    color: var(--color-accent);
    border-radius: var(--radius-xs);
    padding: 1px var(--space-1);
    white-space: nowrap;
  }

  /* Toggle switch */
  :global(.flow-exports__toggle) {
    position: relative;
    width: 28px;
    height: 16px;
    border-radius: var(--radius-md);
    border: none;
    background: var(--color-surface-2, color-mix(in srgb, var(--color-text-primary) 15%, transparent));
    cursor: pointer;
    padding: 0;
    transition: background var(--duration-fast);
    flex-shrink: 0;
  }

  :global(.flow-exports__toggle--on) {
    background: var(--color-accent);
  }

  :global(.flow-exports__toggle:disabled) {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .flow-exports__toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: var(--radius-full);
    background: white;
    transition: transform var(--duration-fast);
    pointer-events: none;
  }

  :global(.flow-exports__toggle--on) .flow-exports__toggle-thumb {
    transform: translateX(12px);
  }
</style>
