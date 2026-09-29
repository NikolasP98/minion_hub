<script lang="ts">
  import { Check, Pencil, RotateCcw, TriangleAlert, X } from 'lucide-svelte';
  import { Button, Input, Select, Spinner, Tooltip, iconSizes } from '$lib/components/ui';
  import TagChip from '$lib/components/tags/TagChip.svelte';
  import * as m from '$lib/paraglide/messages';
  import { languageTag } from '$lib/paraglide/runtime';
  import type {
    CustomPropertyDefinition,
    CustomPropertyValue,
    CustomPropertyValueCell,
  } from '$lib/tables/custom-properties';
  import { validateCustomPropertyValue } from '$lib/tables/custom-properties';
  import { formatPresentedNumber, presentedTone } from '$lib/tables/column-presentation-display';
  import type { CustomPropertyValueActions } from './types';
  import { customPropertyDisplay, retainedArchivedOptions } from './value';
  import { formatFormulaPreviewValue } from './formula-editor';

  let {
    definition,
    cell,
    recordId,
    canEdit,
    unavailable = false,
    secondaryDefinition = null,
    secondaryCell = null,
    secondaryUnavailable = false,
    actions,
    onconfirmed,
  }: {
    definition: CustomPropertyDefinition;
    cell: CustomPropertyValueCell;
    recordId: string;
    canEdit: boolean;
    unavailable?: boolean;
    secondaryDefinition?: CustomPropertyDefinition | null;
    secondaryCell?: CustomPropertyValueCell | null;
    secondaryUnavailable?: boolean;
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
  const choiceOptions = $derived(
    definition.rules.type === 'select' || definition.rules.type === 'multi_select'
      ? definition.rules.options
      : [],
  );
  const formulaDisplay = $derived.by(() => {
    if (
      definition.rules.type !== 'formula' ||
      typeof cell.effectiveValue !== 'number' ||
      !definition.presentation ||
      definition.presentation.version !== 1 ||
      'version' in definition.rules
    )
      return null;
    return formatPresentedNumber(
      cell.effectiveValue,
      definition.presentation.number,
      definition.rules.outputType,
      languageTag(),
      cell.formula?.currency,
    );
  });
  const formulaTone = $derived(
    formulaDisplay === null
      ? null
      : presentedTone(
          cell.effectiveValue,
          cell.formula?.quality,
          definition.presentation?.version === 1 ? definition.presentation : null,
        ),
  );
  const secondaryDisplay = $derived.by(() => {
    const presentation =
      definition.presentation?.version === 1 ? definition.presentation.secondary : null;
    if (
      !presentation ||
      !secondaryDefinition ||
      secondaryDefinition.rules.type !== 'formula' ||
      'version' in secondaryDefinition.rules ||
      !secondaryCell ||
      !['valid', 'partial'].includes(secondaryCell.formula?.quality ?? '') ||
      typeof secondaryCell.effectiveValue !== 'number'
    )
      return null;
    return formatPresentedNumber(
      secondaryCell.effectiveValue,
      presentation.format,
      secondaryDefinition.rules.outputType,
      languageTag(),
      secondaryCell.formula?.currency,
    );
  });
  const hasPartialResult = $derived(
    !!definition.presentation &&
      (cell.formula?.quality === 'partial' ||
        secondaryCell?.formula?.quality === 'partial' ||
        cell.formulaVariables?.some((item) => item.formula.quality === 'partial')),
  );
  const variableRules = $derived(
    definition.rules.type === 'formula' && 'version' in definition.rules
      ? definition.rules.variables
      : [],
  );
  const variablePresentation = $derived(
    definition.presentation?.version === 2 ? definition.presentation.variables : [],
  );
  const variableCells = $derived(cell.formulaVariables ?? []);
  const orderedVariableCells = $derived(
    variableRules
      .map((rule) => variableCells.find((item) => item.variableId === rule.id))
      .filter((item) => item !== undefined),
  );
  const allVariablesBlank = $derived(
    variableCells.length > 0 &&
      variableCells.every((item) => item.formula.quality === 'blank' || item.value == null),
  );
  function variableDisplay(
    variableId: string,
    value: CustomPropertyValue,
    currency: string | null,
  ): string {
    const rule = variableRules.find((item) => item.id === variableId);
    const format = variablePresentation.find((item) => item.variableId === variableId)?.number;
    if (typeof value === 'number' && rule?.outputType.kind === 'number' && format)
      return formatPresentedNumber(value, format, rule.outputType, languageTag(), currency) ?? '—';
    return formatFormulaPreviewValue(
      Array.isArray(value) ? value.join(', ') : value,
      rule?.outputType ?? null,
      languageTag(),
      { yes: m.common_yes(), no: m.common_no() },
      currency,
    );
  }
  function variableTone(
    variableId: string,
    value: unknown,
    quality: string,
  ): 'positive' | 'negative' | null {
    const entry = variablePresentation.find((item) => item.variableId === variableId);
    if (entry?.tone !== 'sign' || quality !== 'valid' || typeof value !== 'number') return null;
    return value < 0 ? 'negative' : 'positive';
  }
  const suppressSecondaryBlank = $derived(
    cell.formula?.quality === 'blank' && secondaryCell?.formula?.quality === 'blank',
  );

  const inputValue = (event: Event) => (event.currentTarget as HTMLInputElement).value;

  function seed(value: CustomPropertyValue) {
    draftText = value == null ? '' : String(value);
    draftBool = typeof value === 'boolean' ? String(value) : '';
    draftOptions = Array.isArray(value) ? [...value] : typeof value === 'string' ? [value] : [];
  }

  function open() {
    if (!canEdit || unavailable || pending || definition.rules.type === 'formula') return;
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

  function formulaRuntimeError(code: string | null | undefined): string {
    if (code === 'division_by_zero') return m.custom_columns_formula_division_by_zero();
    if (code === 'numeric_out_of_range') return m.custom_columns_formula_numeric_out_of_range();
    if (code === 'partial_cost' || code === 'partial_dependency')
      return m.custom_columns_formula_partial_dependency();
    if (code === 'restricted') return m.custom_columns_formula_restricted();
    if (code === 'invalid_dependency' || code === 'source_type_changed')
      return m.custom_columns_formula_source_changed();
    if (code === 'expression_too_complex') return m.custom_columns_formula_too_complex();
    return m.custom_columns_formula_error();
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
      {:else if definition.rules.type === 'select' || definition.rules.type === 'multi_select'}
        <div
          class="options"
          role="listbox"
          aria-multiselectable={definition.rules.type === 'multi_select'}
        >
          {#each choiceOptions as option (option.id)}
            {@const selected = draftOptions.includes(option.id)}
            <Button
              variant="ghost"
              size="xs"
              class="option"
              disabled={!!option.archivedAt && !selected}
              aria-pressed={selected}
              onclick={() => toggleOption(option.id)}
            >
              <TagChip
                size="sm"
                name={option.label}
                color={option.color}
                dashed={!!option.archivedAt}
              />
              {#if selected}<Check size={iconSizes.xs} />{/if}
            </Button>
          {/each}
        </div>
      {/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="editor-actions">
        <Button variant="ghost" size="xs" disabled={pending} onclick={() => (editing = false)}>
          <X size={iconSizes.xs} />
          {m.common_cancel()}
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
          <Button variant="ghost" size="xs" onclick={() => void persist(retryValue, retryVersion)}>
            <RotateCcw size={iconSizes.xs} />
            {m.asyncAction_retry()}
          </Button>
        {:else if failed}
          <Button variant="ghost" size="xs" onclick={() => window.location.reload()}>
            <RotateCcw size={iconSizes.xs} />
            {m.asyncAction_reload()}
          </Button>
        {/if}
      </div>
    </div>
  {:else}
    {#if definition.rules.type === 'formula'}
      <span
        class="formula-value"
        title={cell.formula?.quality === 'partial' && definition.presentation
          ? (definition.description ?? undefined)
          : cell.formula?.code
            ? formulaRuntimeError(cell.formula.code)
            : (definition.description ?? undefined)}
      >
        {#if orderedVariableCells.length}
          {#if allVariablesBlank}
            <span class="value">—</span>
          {:else}
            {#each orderedVariableCells as variable (variable.variableId)}
              {@const presentationEntry = variablePresentation.find(
                (item) => item.variableId === variable.variableId,
              )}
              <span class="variable-output" class:muted={presentationEntry?.emphasis === 'muted'}>
                <span
                  class="value"
                  class:tone-positive={variableTone(
                    variable.variableId,
                    variable.value,
                    variable.formula.quality,
                  ) === 'positive'}
                  class:tone-negative={variableTone(
                    variable.variableId,
                    variable.value,
                    variable.formula.quality,
                  ) === 'negative'}
                >
                  {variable.formula.quality === 'error'
                    ? formulaRuntimeError(variable.formula.code)
                    : variable.formula.quality === 'restricted'
                      ? m.custom_columns_formula_restricted()
                      : variableDisplay(
                          variable.variableId,
                          variable.value,
                          variable.formula.currency,
                        )}
                </span>
              </span>
            {/each}
          {/if}
        {:else}
          <span
            class="value"
            class:tone-positive={formulaTone === 'positive'}
            class:tone-negative={formulaTone === 'negative'}
          >
            {(definition.presentation
              ? (formulaDisplay ?? '—')
              : customPropertyDisplay(
                  definition,
                  cell.effectiveValue,
                  languageTag(),
                  {
                    yes: m.common_yes(),
                    no: m.common_no(),
                  },
                  cell.formula?.currency,
                )) || '—'}
          </span>
          {#if cell.formula?.quality === 'partial' && !definition.presentation}
            <span class="formula-warning">{m.custom_columns_formula_partial()}</span>
          {:else if cell.formula?.quality === 'error'}
            <span class="formula-error">{formulaRuntimeError(cell.formula.code)}</span>
          {/if}
          {#if definition.presentation?.version === 1 && definition.presentation.secondary && !suppressSecondaryBlank}
            <span class="secondary-value">
              {#if secondaryUnavailable}
                {m.custom_columns_format_secondary_unavailable()}
              {:else if secondaryCell?.formula?.quality === 'error'}
                {formulaRuntimeError(secondaryCell.formula.code)}
              {:else if secondaryCell?.formula?.quality === 'restricted'}
                {m.custom_columns_formula_restricted()}
              {:else if secondaryCell?.formula?.quality === 'blank' || secondaryCell?.effectiveValue == null}
                —
              {:else}
                {secondaryDisplay ?? '—'}
              {/if}
            </span>
          {/if}
        {/if}
        {#if hasPartialResult}
          <Tooltip label={m.custom_columns_formula_partial_dependency()} openDelay={0} asChild>
            {#snippet children(tooltipProps)}
              <!-- svelte-ignore a11y_no_noninteractive_tabindex -- the status is focusable so keyboard users can reveal its explanatory tooltip -->
              <span
                {...tooltipProps}
                class="formula-warning partial-warning-button"
                role="status"
                tabindex="0"
                aria-label={m.custom_columns_formula_partial_dependency()}
              >
                <TriangleAlert size={iconSizes.xs} />
              </span>
            {/snippet}
          </Tooltip>
        {/if}
      </span>
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
          {customPropertyDisplay(definition, cell.effectiveValue, languageTag(), {
            yes: m.common_yes(),
            no: m.common_no(),
          }) || '—'}
        </span>
        {#if canEdit}<Pencil size={iconSizes.xs} />{/if}
      </Button>
    {/if}
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
  .formula-value {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: var(--space-1);
  }
  .formula-warning {
    color: var(--color-warning-fg);
  }
  .partial-warning-button {
    display: inline-flex;
    align-items: center;
    color: var(--color-warning-fg);
  }
  .formula-error {
    color: var(--color-danger-fg);
  }
  .tone-positive {
    color: var(--color-success-fg);
  }
  .tone-negative {
    color: var(--color-danger-fg);
  }
  .secondary-value {
    color: var(--color-text-tertiary);
    font-size: var(--font-size-caption);
  }
  .variable-output {
    min-width: 0;
  }
  .variable-output.muted {
    color: var(--color-text-tertiary);
    font-size: var(--font-size-caption);
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
