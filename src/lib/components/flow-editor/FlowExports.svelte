<script lang="ts">
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
          <button
            role="switch"
            aria-checked={v.enabled}
            disabled={!canEdit}
            class="flow-exports__toggle"
            class:flow-exports__toggle--on={v.enabled}
            onclick={() => { if (canEdit) toggle(v.key, v.enabled); }}
            title={v.description ?? v.label}
          >
            <span class="flow-exports__toggle-thumb"></span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .flow-exports {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    min-width: 260px;
  }

  .flow-exports__label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-muted, rgba(255 255 255 / 0.4));
    margin: 0 0 0.25rem;
  }

  .flow-exports__empty {
    font-size: 12px;
    color: var(--color-text-muted, rgba(255 255 255 / 0.35));
    margin: 0;
  }

  .flow-exports__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .flow-exports__item {
    display: grid;
    grid-template-columns: 1fr auto auto auto;
    align-items: center;
    gap: 0.5rem;
  }

  .flow-exports__var-label {
    font-size: 12px;
    color: var(--color-text, rgba(255 255 255 / 0.85));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .flow-exports__var-key {
    font-size: 10px;
    font-family: var(--font-mono, monospace);
    color: var(--color-text-muted, rgba(255 255 255 / 0.4));
  }

  .flow-exports__type-chip {
    font-size: 9px;
    font-family: var(--font-mono, monospace);
    background: var(--color-surface-2, rgba(255 255 255 / 0.08));
    color: var(--color-accent, hsl(var(--accent)));
    border-radius: 3px;
    padding: 1px 4px;
    white-space: nowrap;
  }

  /* Toggle switch */
  .flow-exports__toggle {
    position: relative;
    width: 28px;
    height: 16px;
    border-radius: 8px;
    border: none;
    background: var(--color-surface-2, rgba(255 255 255 / 0.15));
    cursor: pointer;
    padding: 0;
    transition: background 0.15s;
    flex-shrink: 0;
  }

  .flow-exports__toggle--on {
    background: var(--color-accent, hsl(var(--accent)));
  }

  .flow-exports__toggle:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .flow-exports__toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: white;
    transition: transform 0.15s;
    pointer-events: none;
  }

  .flow-exports__toggle--on .flow-exports__toggle-thumb {
    transform: translateX(12px);
  }
</style>
