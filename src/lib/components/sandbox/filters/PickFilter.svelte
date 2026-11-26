<script lang="ts">
  import { X } from 'lucide-svelte';
  import { Button, Combobox, MultiSelectFilter, iconSizes } from '$lib/components/ui';
  import { MAX_MULTI_VALUES, type FilterControl, type PageValue } from '$lib/sandbox/blocks/schema';
  import { optionsQuery, pickerOptions, type PickerOption } from '$lib/sandbox/blocks/query';
  import * as m from '$lib/paraglide/messages';

  /**
   * Single-choice (Combobox) or multi-choice (MultiSelectFilter) picker whose
   * choices are the most common values of one column (spec 150 FR-002). The
   * choices go through the same RBAC-gated query endpoint blocks use.
   */
  interface Props {
    id: string;
    label: string;
    control: Extract<FilterControl, 'select' | 'multi_select'>;
    options: { dataset: string; col: string };
    value: PageValue | null;
    onchange: (value: PageValue | null) => void;
  }

  let { id, label, control, options, value, onchange }: Props = $props();

  let choices = $state<PickerOption[]>([]);
  let status = $state<'loading' | 'ready' | 'failed'>('loading');

  const sourceKey = $derived(`${options.dataset}|${options.col}`);

  $effect(() => {
    void sourceKey;
    const source = { dataset: options.dataset, col: options.col };
    const controller = new AbortController();
    status = 'loading';
    fetch('/api/sandbox/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(optionsQuery(source)),
      signal: controller.signal,
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as {
          rows?: Record<string, unknown>[];
        } | null;
        if (!res.ok) throw new Error(`choices failed (${res.status})`);
        if (controller.signal.aborted) return;
        choices = pickerOptions(body?.rows ?? [], source.col);
        status = 'ready';
      })
      .catch(() => {
        if (!controller.signal.aborted) status = 'failed';
      });
    return () => controller.abort();
  });

  const raw = $derived(new Map(choices.map((c) => [String(c.value), c.value])));
  const selectedKeys = $derived(
    value?.kind === 'select'
      ? [String(value.value)]
      : value?.kind === 'multi'
        ? value.values.map(String)
        : [],
  );

  function pickOne(key: string) {
    const picked = raw.get(key);
    onchange(picked === undefined ? null : { kind: 'select', value: picked });
  }

  function toggle(key: string) {
    const picked = raw.get(key);
    if (picked === undefined) return;
    const current = value?.kind === 'multi' ? value.values : [];
    const has = current.some((v) => String(v) === key);
    if (!has && current.length >= MAX_MULTI_VALUES) return;
    const next = has ? current.filter((v) => String(v) !== key) : [...current, picked];
    onchange(next.length ? { kind: 'multi', values: next } : null);
  }
</script>

<div class="filter" role="group" aria-label={label}>
  <!-- The multi picker prints its own label in the trigger. -->
  {#if control === 'select' || status === 'failed'}
    <span class="t-label filter-label" aria-hidden="true">{label}</span>
  {/if}
  {#if status === 'failed'}
    <span class="t-caption note" role="status">{m.sandbox_filter_options_failed()}</span>
  {:else if control === 'select'}
    <div class="combo">
      <Combobox
        id={`filter-${id}`}
        {label}
        items={choices}
        itemToValue={(c) => String(c.value)}
        itemToString={(c) => String(c.value)}
        placeholder={status === 'loading'
          ? m.sandbox_filter_options_loading()
          : m.sandbox_filter_pick_placeholder()}
        disabled={status === 'loading'}
        value={selectedKeys[0] ?? ''}
        onValueChange={(key) => (key ? pickOne(key) : onchange(null))}
      />
    </div>
    {#if value}
      <Button
        variant="ghost"
        size="sm"
        aria-label={m.sandbox_filter_clear()}
        title={m.sandbox_filter_clear()}
        onclick={() => onchange(null)}
      >
        <X size={iconSizes.sm} />
      </Button>
    {/if}
  {:else}
    <!-- TODO(handoff): the shared MultiSelectFilter popup does not yet follow the APG listbox
         pattern (see PickFilter.mounted.test.ts); the fix belongs to the primitive. -->
    <MultiSelectFilter
      {label}
      allLabel={m.sandbox_filter_all()}
      options={choices.map((c) => ({
        value: String(c.value),
        label: String(c.value),
        count: c.count,
      }))}
      selected={new Set(selectedKeys)}
      onToggle={toggle}
      onClear={() => onchange(null)}
    />
  {/if}
</div>

<style>
  .filter {
    display: flex;
    align-items: center;
    gap: var(--space-control-gap);
  }
  .filter-label {
    color: var(--color-text-secondary);
  }
  .combo {
    min-width: 11rem;
  }
  /* The visible title sits beside the control; the combobox's own label stays for screen readers. */
  .combo :global(.cb-label) {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .note {
    color: var(--color-text-tertiary);
  }
</style>
