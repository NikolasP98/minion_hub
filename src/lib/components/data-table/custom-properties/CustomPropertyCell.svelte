<script lang="ts">
  import { Check, Pencil, RotateCcw, X } from 'lucide-svelte';
  import { Button, Input, Select, Spinner, iconSizes } from '$lib/components/ui';
  import TagChip from '$lib/components/tags/TagChip.svelte';
  import * as m from '$lib/paraglide/messages';
  import { languageTag } from '$lib/paraglide/runtime';
  import type {
    CustomPropertyDefinition,
    CustomPropertyValue,
    CustomPropertyValueCell,
  } from '$lib/tables/custom-properties';
  import { validateCustomPropertyValue } from '$lib/tables/custom-properties';
  import type { CustomPropertyValueActions } from './types';
  import {
    customPropertyDisplay,
    retainedArchivedOptions,
  } from './value';

  let {
    definition,
    cell,
    recordId,
    canEdit,
    unavailable = false,
    actions,
    onconfirmed,
  }: {
    definition: CustomPropertyDefinition;
    cell: CustomPropertyValueCell;
    recordId: string;
    canEdit: boolean;
    unavailable?: boolean;
    actions: CustomPropertyValueActions;
    onconfirmed: (cell: CustomPropertyValueCell) => void;
  } = $props();

  let editing = $state(false);
  let pending = $state(false);
  let failed = $state(false);
  let refreshFailed = $state(false);
  let error = $state('');
  let sequence = 0;
  let retryValue = $state<CustomPropertyValue>(null);
  let retryVersion = $state(0);
  let retryAllowed = $state(false);
  let draftText = $state('');
  let draftBool = $state('');
  let draftOptions = $state<string[]>([]);

  const inputValue = (event: Event) => (event.currentTarget as HTMLInputElement).value;

  function seed(value: CustomPropertyValue) {
    draftText = value == null ? '' : String(value);
    draftBool = typeof value === 'boolean' ? String(value) : '';
    draftOptions = Array.isArray(value) ? [...value] : typeof value === 'string' ? [value] : [];
  }

  function open() {
    if (!canEdit || unavailable || pending) return;
    seed(cell.effectiveValue);
    error = '';
    editing = true;
  }

  function parsed(): CustomPropertyValue {
    if (definition.type === 'number') return draftText === '' ? null : Number(draftText);
    if (definition.type === 'boolean') return draftBool === '' ? null : draftBool === 'true';
    if (definition.type === 'select') return draftOptions[0] ?? null;
    if (definition.type === 'multi_select') return draftOptions;
    return draftText === '' ? null : draftText;
  }

  const same = (a: CustomPropertyValue, b: CustomPropertyValue) =>
    JSON.stringify(a) === JSON.stringify(b);

  async function persist(value: CustomPropertyValue, expectedVersion = cell.version) {
    const retained = retainedArchivedOptions(definition, cell.value);
    const valid = validateCustomPropertyValue(definition.rules, value, retained);
    if (!valid.ok) {
      error = m.custom_columns_invalid_value();
      return;
    }
    const request = ++sequence;
    retryValue = valid.value;
    retryVersion = expectedVersion;
    retryAllowed = false;
    pending = true;
    failed = false;
    refreshFailed = false;
    error = '';
    try {
      const result = await actions.save(definition, recordId, valid.value, expectedVersion);
      if (request !== sequence) return;
      onconfirmed(result.cell);
      failed = false;
      refreshFailed = result.refreshFailed;
      editing = false;
    } catch {
      if (request !== sequence) return;
      try {
        const authoritative = await actions.read(definition.id, recordId);
        if (request !== sequence) return;
        if (authoritative) {
          onconfirmed(authoritative);
          if (same(authoritative.value, valid.value)) {
            failed = false;
            editing = false;
            return;
          }
          retryVersion = authoritative.version;
          retryAllowed = true;
        }
      } catch {
        retryAllowed = false;
      }
      failed = true;
      error = retryAllowed ? m.custom_columns_save_failed() : m.asyncAction_unknown();
    } finally {
      if (request === sequence) pending = false;
    }
  }

  function submit() {
    void persist(parsed());
  }

  function toggleOption(id: string) {
    if (definition.type === 'select') draftOptions = [id];
    else
      draftOptions = draftOptions.includes(id)
        ? draftOptions.filter((value) => value !== id)
        : [...draftOptions, id];
  }

  $effect(() => {
    void recordId;
    void definition.id;
    sequence++;
    pending = false;
    failed = false;
    retryAllowed = false;
    refreshFailed = false;
    editing = false;
  });
</script>

<div class="property-cell" class:has-error={failed}>
  {#if unavailable}
    <span class="unavailable" title={m.custom_columns_unavailable()}>—</span>
  {:else if editing}
    <div class="editor">
      {#if definition.rules.type === 'text'}
        <Input
          size="sm"
          value={draftText}
          maxlength={definition.rules.maxLength ?? undefined}
          oninput={(event) => (draftText = inputValue(event))}
        />
      {:else if definition.rules.type === 'number'}
        <Input
          size="sm"
          type="number"
          value={draftText}
          min={definition.rules.min ?? undefined}
          max={definition.rules.max ?? undefined}
          step={definition.rules.precision == null ? 'any' : 10 ** -definition.rules.precision}
          oninput={(event) => (draftText = inputValue(event))}
        />
      {:else if definition.rules.type === 'date'}
        <input
          class="date-input"
          type="date"
          value={draftText}
          min={definition.rules.min ?? undefined}
          max={definition.rules.max ?? undefined}
          oninput={(event) => (draftText = inputValue(event))}
        />
      {:else if definition.rules.type === 'boolean'}
        <Select
          size="sm"
          value={draftBool}
          options={[
            { value: '', label: m.custom_columns_clear_value() },
            { value: 'true', label: m.common_yes() },
            { value: 'false', label: m.common_no() },
          ]}
          onchange={(value) => (draftBool = String(value))}
        />
      {:else}
        <div class="options" role="listbox" aria-multiselectable={definition.rules.type === 'multi_select'}>
          {#each definition.rules.options as option (option.id)}
            {@const selected = draftOptions.includes(option.id)}
            <Button
              variant="ghost"
              size="xs"
              class="option"
              disabled={!!option.archivedAt && !selected}
              aria-pressed={selected}
              onclick={() => toggleOption(option.id)}
            >
              <TagChip size="sm" name={option.label} color={option.color} dashed={!!option.archivedAt} />
              {#if selected}<Check size={iconSizes.xs} />{/if}
            </Button>
          {/each}
        </div>
      {/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="editor-actions">
        <Button variant="ghost" size="xs" disabled={pending} onclick={() => (editing = false)}>
          <X size={iconSizes.xs} /> {m.common_cancel()}
        </Button>
        {#if definition.type === 'select' || definition.type === 'multi_select'}
          <Button variant="ghost" size="xs" disabled={pending} onclick={() => void persist(null)}>
            {m.custom_columns_clear_value()}
          </Button>
        {/if}
        <Button variant="primary" size="xs" disabled={pending} onclick={submit}>
          {#if pending}<Spinner size="xs" />{/if}{m.common_save()}
        </Button>
        {#if failed && retryAllowed}
          <Button
            variant="ghost"
            size="xs"
            onclick={() => void persist(retryValue, retryVersion)}
          >
            <RotateCcw size={iconSizes.xs} /> {m.asyncAction_retry()}
          </Button>
        {:else if failed}
          <Button variant="ghost" size="xs" onclick={() => window.location.reload()}>
            <RotateCcw size={iconSizes.xs} /> {m.asyncAction_reload()}
          </Button>
        {/if}
      </div>
    </div>
  {:else}
    <Button
      variant="ghost"
      size="xs"
      class="value-button"
      disabled={!canEdit}
      title={definition.description ?? undefined}
      onclick={open}
    >
      <span class="value">
        {customPropertyDisplay(definition, cell.effectiveValue, languageTag(), { yes: m.common_yes(), no: m.common_no() }) || '—'}
      </span>
      {#if canEdit}<Pencil size={iconSizes.xs} />{/if}
    </Button>
    {#if pending}<Spinner size="xs" label={m.custom_columns_saving()} />{/if}
    {#if refreshFailed}
      <span class="refresh-warning" role="status">{m.custom_columns_saved_refresh_failed()}</span>
    {/if}
  {/if}
</div>

<style>
  .property-cell {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }
  .property-cell.has-error {
    border-radius: var(--radius-sm);
    outline: 1px solid var(--color-danger-border);
  }
  :global(.value-button) {
    min-width: 0;
    max-width: 100%;
  }
  .value {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
  }
  .date-input {
    min-height: var(--control-height-sm);
    padding-inline: var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    background: var(--color-surface-1);
  }
  .options {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    overflow-y: auto;
  }
  :global(.option) {
    justify-content: flex-start;
  }
  .editor-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-1);
  }
  .error {
    color: var(--color-danger-fg);
    font-size: var(--font-size-caption);
  }
  .refresh-warning {
    color: var(--color-warning-fg);
    font-size: var(--font-size-caption);
  }
  .unavailable {
    color: var(--color-text-tertiary);
  }
</style>
