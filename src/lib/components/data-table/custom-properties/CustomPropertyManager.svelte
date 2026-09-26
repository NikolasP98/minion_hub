<script lang="ts">
  import { Archive, Check, Plus, RotateCcw, Settings2, X } from 'lucide-svelte';
  import { Button, Input, Modal, Select, Toggle, iconSizes } from '$lib/components/ui';
  import { FormField } from '$lib/components/ui/foundations';
  import TagChip from '$lib/components/tags/TagChip.svelte';
  import { CRM_TAG_COLORS } from '$lib/components/crm/tag-colors';
  import * as m from '$lib/paraglide/messages';
  import {
    CUSTOM_PROPERTY_DESCRIPTION_MAX,
    CUSTOM_PROPERTY_LABEL_MAX,
    CUSTOM_PROPERTY_OPTIONS_MAX,
    CUSTOM_PROPERTY_TEXT_MAX,
    CUSTOM_PROPERTY_TYPES,
    type CreateCustomPropertyInput,
    type CustomPropertyColor,
    type CustomPropertyDefinition,
    type CustomPropertyOption,
    type CustomPropertyRules,
    type CustomPropertyTableId,
    type CustomPropertyType,
    type CustomPropertyValue,
    validateCustomPropertyRules,
    validateCustomPropertyValue,
  } from '$lib/tables/custom-properties';
  import type { CustomPropertyManagerActions } from './types';
  import { CustomPropertyHttpError } from './api';

  let {
    open = $bindable(false),
    scopeKey,
    tableId,
    definitions,
    canManage,
    loadFailed = false,
    selectedId = null,
    createOnOpen = false,
    actions,
    onchanged,
    onloaded,
    isScopeCurrent,
    onreload,
  }: {
    open?: boolean;
    scopeKey: string;
    tableId: CustomPropertyTableId;
    definitions: CustomPropertyDefinition[];
    canManage: boolean;
    loadFailed?: boolean;
    selectedId?: string | null;
    createOnOpen?: boolean;
    actions: CustomPropertyManagerActions;
    onchanged: (definition: CustomPropertyDefinition) => void;
    onloaded: (definitions: CustomPropertyDefinition[]) => void;
    isScopeCurrent: (scopeKey: string) => boolean;
    onreload: () => void;
  } = $props();

  let mode = $state<'list' | 'edit'>('list');
  let editingId = $state<string | null>(null);
  let label = $state('');
  let description = $state('');
  let type = $state<CustomPropertyType>('text');
  let maxLength = $state('');
  let min = $state('');
  let max = $state('');
  let precision = $state('');
  let maxSelections = $state('');
  let options = $state<CustomPropertyOption[]>([]);
  let hasDefault = $state(false);
  let defaultText = $state('');
  let defaultBool = $state('');
  let defaultOptions = $state<string[]>([]);
  let busy = $state(false);
  let error = $state('');
  let confirmLifecycle = $state<CustomPropertyDefinition | null>(null);
  let openedKey = $state('');
  const inputValue = (event: Event) => (event.currentTarget as HTMLInputElement).value;

  const active = $derived(definitions.filter((definition) => !definition.archivedAt));
  const archived = $derived(definitions.filter((definition) => !!definition.archivedAt));
  const editing = $derived(
    editingId ? (definitions.find((definition) => definition.id === editingId) ?? null) : null,
  );

  const typeOptions = $derived(
    CUSTOM_PROPERTY_TYPES.map((value) => ({ value, label: typeLabel(value) })),
  );

  function typeLabel(value: CustomPropertyType): string {
    if (value === 'text') return m.custom_columns_type_text();
    if (value === 'number') return m.custom_columns_type_number();
    if (value === 'date') return m.custom_columns_type_date();
    if (value === 'boolean') return m.custom_columns_type_boolean();
    if (value === 'select') return m.custom_columns_type_select();
    return m.custom_columns_type_multi_select();
  }

  function resetDraft() {
    editingId = null;
    label = '';
    description = '';
    type = 'text';
    maxLength = '';
    min = '';
    max = '';
    precision = '';
    maxSelections = '';
    options = [];
    hasDefault = false;
    defaultText = '';
    defaultBool = '';
    defaultOptions = [];
    error = '';
  }

  function create() {
    resetDraft();
    mode = 'edit';
  }

  function edit(definition: CustomPropertyDefinition) {
    editingId = definition.id;
    label = definition.label;
    description = definition.description ?? '';
    type = definition.type;
    maxLength = definition.rules.type === 'text' ? String(definition.rules.maxLength ?? '') : '';
    min =
      definition.rules.type === 'number' || definition.rules.type === 'date'
        ? String(definition.rules.min ?? '')
        : '';
    max =
      definition.rules.type === 'number' || definition.rules.type === 'date'
        ? String(definition.rules.max ?? '')
        : '';
    precision = definition.rules.type === 'number' ? String(definition.rules.precision ?? '') : '';
    maxSelections =
      definition.rules.type === 'multi_select' ? String(definition.rules.maxSelections ?? '') : '';
    options =
      definition.rules.type === 'select' || definition.rules.type === 'multi_select'
        ? definition.rules.options.map((option) => ({ ...option }))
        : [];
    hasDefault = definition.hasDefault;
    const value = definition.defaultValue;
    defaultText = value == null ? '' : String(value);
    defaultBool = typeof value === 'boolean' ? String(value) : '';
    defaultOptions = Array.isArray(value) ? [...value] : typeof value === 'string' ? [value] : [];
    error = '';
    mode = 'edit';
  }

  function rules(): CustomPropertyRules {
    if (type === 'text') return { type, maxLength: maxLength === '' ? null : Number(maxLength) };
    if (type === 'number')
      return {
        type,
        min: min === '' ? null : Number(min),
        max: max === '' ? null : Number(max),
        precision: precision === '' ? null : Number(precision),
      };
    if (type === 'date') return { type, min: min || null, max: max || null };
    if (type === 'boolean') return { type };
    if (type === 'select') return { type, options };
    return {
      type,
      options,
      maxSelections: maxSelections === '' ? null : Number(maxSelections),
    };
  }

  function defaultValue(): CustomPropertyValue {
    if (!hasDefault) return null;
    if (type === 'number') return defaultText === '' ? null : Number(defaultText);
    if (type === 'boolean') return defaultBool === '' ? null : defaultBool === 'true';
    if (type === 'select') return defaultOptions[0] ?? null;
    if (type === 'multi_select') return defaultOptions;
    return defaultText === '' ? null : defaultText;
  }

  function validate(): { rules: CustomPropertyRules; defaultValue: CustomPropertyValue } | null {
    const nextRules = rules();
    if (!label.trim() || label.trim().length > CUSTOM_PROPERTY_LABEL_MAX) {
      error = m.custom_columns_invalid_name();
      return null;
    }
    if (description.length > CUSTOM_PROPERTY_DESCRIPTION_MAX) {
      error = m.custom_columns_invalid_description();
      return null;
    }
    if (!validateCustomPropertyRules(nextRules).ok) {
      error = m.custom_columns_invalid_rules();
      return null;
    }
    const nextDefault = defaultValue();
    if (hasDefault && !validateCustomPropertyValue(nextRules, nextDefault).ok) {
      error = m.custom_columns_invalid_default();
      return null;
    }
    return { rules: nextRules, defaultValue: nextDefault };
  }

  async function save() {
    const valid = validate();
    if (!valid) return;
    busy = true;
    const requestScope = scopeKey;
    error = '';
    const base = editing;
    const existingIds = new Set(definitions.map((definition) => definition.id));
    const requested = {
      label: label.trim(),
      description: description.trim() || null,
      rules: valid.rules,
      hasDefault,
      defaultValue: valid.defaultValue,
    };
    try {
      let saved: CustomPropertyDefinition;
      if (base) {
        saved = await actions.update(base, {
          tableId,
          expectedVersion: base.version,
          ...requested,
        });
      } else {
        const input: CreateCustomPropertyInput = {
          tableId,
          ...requested,
        };
        saved = await actions.create(input);
      }
      if (!isScopeCurrent(requestScope)) return;
      onchanged(saved);
      mode = 'list';
      resetDraft();
    } catch (cause) {
      try {
        const refreshed = await actions.list(tableId);
        if (!isScopeCurrent(requestScope)) return;
        onloaded(refreshed);
        const matches = (entry: CustomPropertyDefinition) =>
          entry.label === requested.label &&
          entry.description === requested.description &&
          JSON.stringify(entry.rules) === JSON.stringify(requested.rules) &&
          entry.hasDefault === requested.hasDefault &&
          JSON.stringify(entry.defaultValue) === JSON.stringify(requested.defaultValue);
        const converged =
          cause instanceof TypeError
            ? base
              ? refreshed.find((entry) => entry.id === base.id && matches(entry))
              : refreshed.find((entry) => !existingIds.has(entry.id) && matches(entry))
            : undefined;
        if (converged) {
          onchanged(converged);
          mode = 'list';
          resetDraft();
          return;
        }
      } catch {
        // Preserve the original mutation error when authoritative reconciliation also fails.
      }
      error =
        cause instanceof CustomPropertyHttpError && cause.status === 409
          ? m.custom_columns_conflict()
          : m.custom_columns_save_failed();
    } finally {
      busy = false;
    }
  }

  function addOption() {
    if (options.length >= CUSTOM_PROPERTY_OPTIONS_MAX) return;
    options = [
      ...options,
      {
        id: crypto.randomUUID(),
        label: m.custom_columns_new_option(),
        color: CRM_TAG_COLORS[options.length % CRM_TAG_COLORS.length],
        archivedAt: null,
      },
    ];
  }

  function updateOption(id: string, patch: Partial<CustomPropertyOption>) {
    options = options.map((option) => (option.id === id ? { ...option, ...patch } : option));
  }

  function toggleDefaultOption(id: string) {
    defaultOptions =
      type === 'select'
        ? [id]
        : defaultOptions.includes(id)
          ? defaultOptions.filter((value) => value !== id)
          : [...defaultOptions, id];
  }

  async function lifecycle(definition: CustomPropertyDefinition) {
    busy = true;
    const requestScope = scopeKey;
    error = '';
    try {
      const saved = await actions.lifecycle(definition, {
        tableId,
        expectedVersion: definition.version,
        action: definition.archivedAt ? 'restore' : 'archive',
      });
      if (!isScopeCurrent(requestScope)) return;
      onchanged(saved);
      confirmLifecycle = null;
    } catch (cause) {
      try {
        const refreshed = await actions.list(tableId);
        if (!isScopeCurrent(requestScope)) return;
        onloaded(refreshed);
        const current = refreshed.find((entry) => entry.id === definition.id);
        const shouldArchive = !definition.archivedAt;
        if (cause instanceof TypeError && current && !!current.archivedAt === shouldArchive) {
          onchanged(current);
          confirmLifecycle = null;
          return;
        }
      } catch {
        // Preserve the original mutation error when authoritative reconciliation also fails.
      }
      error =
        cause instanceof CustomPropertyHttpError && cause.status === 409
          ? m.custom_columns_conflict()
          : m.custom_columns_save_failed();
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    if (!open) {
      openedKey = '';
      return;
    }
    const nextKey = `${selectedId ?? ''}:${createOnOpen ? 'create' : 'list'}`;
    if (openedKey === nextKey) return;
    openedKey = nextKey;
    if (createOnOpen) {
      create();
      return;
    }
    if (selectedId) {
      const selected = definitions.find((definition) => definition.id === selectedId);
      if (selected) edit(selected);
    } else mode = 'list';
  });
</script>

<Modal bind:open title={m.custom_columns_manage_title()} size="lg">
  {#if mode === 'list'}
    <div class="manager-list">
      <div class="manager-head">
        <p class="t-caption">{m.custom_columns_manage_hint()}</p>
        {#if canManage}
          <Button variant="primary" size="sm" onclick={create}>
            <Plus size={iconSizes.sm} />
            {m.custom_columns_add()}
          </Button>
        {/if}
      </div>
      {#if loadFailed}
        <div class="load-error" role="status">
          <span>{m.custom_columns_load_failed()}</span>
          <Button variant="secondary" size="xs" onclick={onreload}>{m.asyncAction_retry()}</Button>
        </div>
      {/if}
      {#if active.length === 0}
        <p class="empty">{m.custom_columns_empty()}</p>
      {/if}
      {#each active as definition (definition.id)}
        <div class="definition-row">
          <div class="definition-copy">
            <strong>{definition.label}</strong>
            <span class="t-caption">{typeLabel(definition.type)}</span>
            {#if definition.description}<span class="t-caption">{definition.description}</span>{/if}
          </div>
          {#if canManage}
            <Button variant="ghost" size="xs" onclick={() => edit(definition)}>
              <Settings2 size={iconSizes.xs} />
              {m.common_edit()}
            </Button>
            <Button variant="ghost" size="xs" onclick={() => (confirmLifecycle = definition)}>
              <Archive size={iconSizes.xs} />
              {m.custom_columns_archive()}
            </Button>
          {/if}
        </div>
      {/each}
      {#if archived.length}
        <section class="archived">
          <h3 class="t-section">{m.custom_columns_archived()}</h3>
          {#each archived as definition (definition.id)}
            <div class="definition-row archived-row">
              <div class="definition-copy">
                <strong>{definition.label}</strong><span class="t-caption"
                  >{typeLabel(definition.type)}</span
                >
              </div>
              {#if canManage}
                <Button variant="ghost" size="xs" onclick={() => (confirmLifecycle = definition)}>
                  <RotateCcw size={iconSizes.xs} />
                  {m.custom_columns_restore()}
                </Button>
              {/if}
            </div>
          {/each}
        </section>
      {/if}
    </div>
  {:else}
    <form
      class="property-form"
      onsubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div class="form-grid">
        <FormField label={m.custom_columns_name()} required>
          {#snippet children(p)}
            <Input {...p} size="sm" maxlength={CUSTOM_PROPERTY_LABEL_MAX} bind:value={label} />
          {/snippet}
        </FormField>
        <FormField label={m.custom_columns_type()}>
          {#snippet children(p)}
            <Select {...p} size="sm" options={typeOptions} bind:value={type} />
          {/snippet}
        </FormField>
      </div>
      <FormField label={m.custom_columns_description()}>
        {#snippet children(p)}
          <textarea {...p} maxlength={CUSTOM_PROPERTY_DESCRIPTION_MAX} bind:value={description}
          ></textarea>
        {/snippet}
      </FormField>

      {#if type === 'text'}
        <FormField label={m.custom_columns_max_length()}>
          {#snippet children(p)}
            <Input
              {...p}
              size="sm"
              type="number"
              min="1"
              max={CUSTOM_PROPERTY_TEXT_MAX}
              bind:value={maxLength}
            />
          {/snippet}
        </FormField>
      {:else if type === 'number'}
        <div class="form-grid three">
          <FormField label={m.custom_columns_min()}
            >{#snippet children(p)}<Input
                {...p}
                size="sm"
                type="number"
                bind:value={min}
              />{/snippet}</FormField
          >
          <FormField label={m.custom_columns_max()}
            >{#snippet children(p)}<Input
                {...p}
                size="sm"
                type="number"
                bind:value={max}
              />{/snippet}</FormField
          >
          <FormField label={m.custom_columns_precision()}
            >{#snippet children(p)}<Input
                {...p}
                size="sm"
                type="number"
                min="0"
                max="12"
                bind:value={precision}
              />{/snippet}</FormField
          >
        </div>
      {:else if type === 'date'}
        <div class="form-grid">
          <FormField label={m.custom_columns_min()}
            >{#snippet children(p)}<input
                {...p}
                class="date-input"
                type="date"
                bind:value={min}
              />{/snippet}</FormField
          >
          <FormField label={m.custom_columns_max()}
            >{#snippet children(p)}<input
                {...p}
                class="date-input"
                type="date"
                bind:value={max}
              />{/snippet}</FormField
          >
        </div>
      {/if}

      {#if type === 'select' || type === 'multi_select'}
        <section class="options-editor">
          <div class="options-head">
            <h3 class="t-section">{m.custom_columns_options()}</h3>
            <Button variant="outline" size="xs" type="button" onclick={addOption}
              ><Plus size={iconSizes.xs} /> {m.custom_columns_add_option()}</Button
            >
          </div>
          {#each options as option (option.id)}
            <div class="option-row" class:option-archived={!!option.archivedAt}>
              <Input
                size="sm"
                value={option.label}
                maxlength={CUSTOM_PROPERTY_LABEL_MAX}
                disabled={!!option.archivedAt}
                oninput={(event) => updateOption(option.id, { label: inputValue(event) })}
              />
              <div class="colors">
                {#each CRM_TAG_COLORS as color, index (color)}
                  <Button
                    variant="ghost"
                    size="xs"
                    shape="icon"
                    type="button"
                    class="color-choice"
                    aria-label={m.custom_columns_color_choice({ n: index + 1 })}
                    aria-pressed={option.color === color}
                    disabled={!!option.archivedAt}
                    onclick={() => updateOption(option.id, { color: color as CustomPropertyColor })}
                  >
                    <TagChip size="sm" name="" {color} />{#if option.color === color}<Check
                        size={iconSizes.xs}
                      />{/if}
                  </Button>
                {/each}
              </div>
              <Button
                variant="ghost"
                size="xs"
                type="button"
                onclick={() =>
                  updateOption(option.id, {
                    archivedAt: option.archivedAt ? null : new Date().toISOString(),
                  })}
              >
                {option.archivedAt ? m.custom_columns_restore() : m.custom_columns_archive()}
              </Button>
            </div>
          {/each}
          {#if type === 'multi_select'}
            <FormField label={m.custom_columns_max_selections()}
              >{#snippet children(p)}<Input
                  {...p}
                  size="sm"
                  type="number"
                  min="1"
                  max={CUSTOM_PROPERTY_OPTIONS_MAX}
                  bind:value={maxSelections}
                />{/snippet}</FormField
            >
          {/if}
        </section>
      {/if}

      <div class="default-block">
        <Toggle bind:checked={hasDefault} label={m.custom_columns_default()} />
        <p class="t-caption">{m.custom_columns_default_hint()}</p>
        {#if hasDefault}
          {#if type === 'boolean'}
            <Select
              size="sm"
              bind:value={defaultBool}
              options={[
                { value: '', label: m.custom_columns_clear_value() },
                { value: 'true', label: m.common_yes() },
                { value: 'false', label: m.common_no() },
              ]}
            />
          {:else if type === 'select' || type === 'multi_select'}
            <div class="default-options">
              {#each options.filter((option) => !option.archivedAt) as option (option.id)}
                <Button
                  variant="ghost"
                  size="xs"
                  type="button"
                  aria-pressed={defaultOptions.includes(option.id)}
                  onclick={() => toggleDefaultOption(option.id)}
                  ><TagChip
                    size="sm"
                    name={option.label}
                    color={option.color}
                  />{#if defaultOptions.includes(option.id)}<Check
                      size={iconSizes.xs}
                    />{/if}</Button
                >
              {/each}
            </div>
          {:else if type === 'date'}
            <input class="date-input" type="date" bind:value={defaultText} />
          {:else}
            <Input
              size="sm"
              type={type === 'number' ? 'number' : 'text'}
              bind:value={defaultText}
            />
          {/if}
        {/if}
      </div>

      {#if error}<p class="form-error" role="alert">{error}</p>{/if}
      <div class="form-actions">
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onclick={() => {
            mode = 'list';
            resetDraft();
          }}>{m.common_cancel()}</Button
        >
        <Button
          variant="primary"
          size="sm"
          type="submit"
          loading={busy}
          disabled={!canManage || busy}>{m.common_save()}</Button
        >
      </div>
    </form>
  {/if}
</Modal>

{#if confirmLifecycle}
  <Modal
    open={true}
    title={confirmLifecycle.archivedAt ? m.custom_columns_restore() : m.custom_columns_archive()}
    size="sm"
    onclose={() => (confirmLifecycle = null)}
  >
    <p>
      {confirmLifecycle.archivedAt
        ? m.custom_columns_restore_confirm()
        : m.custom_columns_archive_confirm()}
    </p>
    {#if error}<p class="form-error" role="alert">{error}</p>{/if}
    <div class="form-actions">
      <Button variant="ghost" size="sm" onclick={() => (confirmLifecycle = null)}
        ><X size={iconSizes.xs} /> {m.common_cancel()}</Button
      >
      <Button
        variant={confirmLifecycle.archivedAt ? 'primary' : 'danger'}
        size="sm"
        loading={busy}
        onclick={() => void lifecycle(confirmLifecycle!)}
        >{confirmLifecycle.archivedAt
          ? m.custom_columns_restore()
          : m.custom_columns_archive()}</Button
      >
    </div>
  </Modal>
{/if}

<style>
  .manager-list,
  .property-form,
  .definition-copy,
  .options-editor,
  .default-block {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .manager-head,
  .load-error,
  .definition-row,
  .options-head,
  .option-row,
  .colors,
  .default-options,
  .form-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .manager-head,
  .definition-row,
  .options-head {
    justify-content: space-between;
  }
  .load-error {
    justify-content: space-between;
    color: var(--color-warning-fg);
  }
  .definition-row,
  .option-row,
  .default-block {
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
  }
  .definition-copy {
    gap: var(--space-1);
    min-width: 0;
  }
  .archived,
  .options-editor {
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border);
  }
  .archived-row,
  .option-archived {
    opacity: 0.7;
  }
  .form-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }
  .form-grid.three {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  textarea {
    width: 100%;
    min-height: var(--control-height-lg);
    padding: var(--space-2);
    resize: vertical;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    background: var(--color-surface-1);
  }
  .date-input {
    width: 100%;
    min-height: var(--control-height-sm);
    padding-inline: var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    background: var(--color-surface-1);
  }
  .option-row {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .colors {
    flex-wrap: wrap;
  }
  .color-choice[aria-pressed='true'] {
    box-shadow: var(--shadow-focus);
  }
  .empty {
    color: var(--color-text-tertiary);
  }
  .form-error {
    color: var(--color-danger-fg);
  }
  .form-actions {
    justify-content: flex-end;
  }
  @media (max-width: 47.99875rem) {
    .form-grid,
    .form-grid.three {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
