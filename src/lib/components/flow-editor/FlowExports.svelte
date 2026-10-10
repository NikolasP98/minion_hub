<script lang="ts">
  import { SvelteMap } from 'svelte/reactivity';
  import { recordPathSegment } from '$lib/utils/record-path';
  import { createOptimistic } from '$lib/utils/optimistic';
  import { toastError } from '$lib/state/ui/toast.svelte';
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

  // HC-040 ownership fence: every write is keyed by the (flow, variable) it
  // was dispatched for, so its overlay, rollback and accepted value can only
  // ever touch that pair — never the flow selected when the reply lands.
  // One write per pair is in flight at a time (the switch is busy meanwhile),
  // which is the only sound ordering for an `{ ok }` reply that echoes no value.
  const own = (flow: string, varKey: string) => JSON.stringify([flow, varKey]);
  const inFlight = createOptimistic<boolean | undefined>();
  // Accepted writes, remembered against the committed value they were made
  // from: reloaded data that differs from that base wins over the memory.
  // ponytail: reloaded data equal to `base` is indistinguishable from the stale prop;
  // TODO(handoff): HC-040 — give agents/autonomous/[id]/+page.server.ts a depends()
  // key so a targeted invalidate() can replace this memory (list page has one).
  const accepted = new SvelteMap<string, { base: boolean | undefined; value: boolean }>();

  const shown = $derived.by(() => {
    const out: Record<string, boolean> = { ...toggles };
    for (const s of specs) {
      const key = own(flowId, s.key);
      const done = accepted.get(key);
      const committed = done && done.base === toggles[s.key] ? done.value : toggles[s.key];
      const v = inFlight.get(key, committed);
      if (v !== undefined) out[s.key] = v;
    }
    return out;
  });

  const resolved = $derived(resolveFlowVariables(specs, shown));

  const TYPE_LABELS: Record<string, string> = {
    int: 'int',
    float: 'float',
    string: 'str',
    bool: 'bool',
    list: 'list',
    object: 'obj',
  };

  async function toggle(varKey: string, current: boolean) {
    // Everything the reply may touch is captured before the first await.
    const key = own(flowId, varKey);
    if (inFlight.isPending(key)) return;
    const base = toggles[varKey];
    const path = `/api/flows/${recordPathSegment(flowId)}/exports`;
    const next = !current;
    const ok = await inFlight.run(key, next, async () => {
      const res = await fetch(path, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ varKey, enabled: next }),
      });
      // Remembered before the overlay clears, so an accepted write never flashes the old value.
      if (res.ok) accepted.set(key, { base, value: next });
      return res.ok;
    });
    if (!ok) toastError(m.flow_exports_update_failed());
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
          <Button
            variant="ghost"
            role="switch"
            aria-checked={v.enabled}
            aria-label={v.label}
            disabled={!canEdit}
            loading={inFlight.isPending(own(flowId, v.key))}
            class={`flow-exports__toggle${v.enabled ? ' flow-exports__toggle--on' : ''}`}
            onclick={() => {
              if (canEdit) toggle(v.key, v.enabled);
            }}
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
    color: var(
      --color-text-tertiary,
      color-mix(in srgb, var(--color-text-primary) 40%, transparent)
    );
    margin: 0 0 var(--space-1);
  }

  .flow-exports__empty {
    font-size: var(--font-size-caption);
    color: var(
      --color-text-tertiary,
      color-mix(in srgb, var(--color-text-primary) 35%, transparent)
    );
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
    color: var(
      --color-text-primary,
      color-mix(in srgb, var(--color-text-primary) 85%, transparent)
    );
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .flow-exports__var-key {
    font-size: var(--font-size-telemetry);
    font-family: var(--font-mono, monospace);
    color: var(
      --color-text-tertiary,
      color-mix(in srgb, var(--color-text-primary) 40%, transparent)
    );
  }

  .flow-exports__type-chip {
    font-size: var(--font-size-telemetry);
    font-family: var(--font-mono, monospace);
    background: var(
      --color-surface-2,
      color-mix(in srgb, var(--color-text-primary) 8%, transparent)
    );
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
    background: var(
      --color-surface-2,
      color-mix(in srgb, var(--color-text-primary) 15%, transparent)
    );
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

  /* Touch floor: each row and its switch hit area reach --control-height-touch
     on coarse pointers without changing the 28×16 visual. */
  @media (hover: none), (pointer: coarse) {
    .flow-exports__item {
      min-height: var(--control-height-touch);
    }
    :global(.flow-exports__toggle)::after {
      content: '';
      position: absolute;
      inset: calc((16px - var(--control-height-touch)) / 2)
        calc((28px - var(--control-height-touch)) / 2);
    }
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
