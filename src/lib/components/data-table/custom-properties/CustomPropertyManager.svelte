<script lang="ts">
  import { Archive, Check, Plus, RotateCcw, Settings2, X } from 'lucide-svelte';
  import { Button, Input, Modal, Select, Toggle, iconSizes } from '$lib/components/ui';
  import { FormField } from '$lib/components/ui/foundations';
  import TagChip from '$lib/components/tags/TagChip.svelte';
  import * as m from '$lib/paraglide/messages';
  import { languageTag } from '$lib/paraglide/runtime';
  import {
    CUSTOM_PROPERTY_COLORS,
    CUSTOM_PROPERTY_DESCRIPTION_MAX,
    CUSTOM_PROPERTY_LABEL_MAX,
    CUSTOM_PROPERTY_OPTIONS_MAX,
    CUSTOM_PROPERTY_TEXT_MAX,
    CUSTOM_PROPERTY_TYPES,
    type CreateCustomPropertyInput,
    type CustomPropertyColor,
    type CustomPropertyDefinition,
    type CustomPropertyInputRules,
    type CustomPropertyOption,
    type CustomPropertyTableId,
    type CustomPropertyType,
    type CustomPropertyValue,
    type CustomPropertyValueCell,
    validateCustomPropertyRules,
    validateCustomPropertyValue,
  } from '$lib/tables/custom-properties';
  import {
    formatFormulaAst,
    type FormulaAnalysis,
    type FormulaDiagnostic,
    type FormulaPreviewResponse,
    type FormulaSourceDescriptor,
  } from '$lib/tables/formula';
  import FormulaEditor from './FormulaEditor.svelte';
  import { formatFormulaPreviewValue } from './formula-editor';
  import type { CustomPropertyManagerActions } from './types';
  import { CustomPropertyHttpError, loadFormulaCatalog, previewFormula } from './api';
  import {
    columnPresentationSchema,
    type ColumnPresentation,
  } from '$lib/tables/column-presentation';
  import { formatPresentedNumber, presentedTone } from '$lib/tables/column-presentation-display';
  import ColumnPresentationEditor from './ColumnPresentationEditor.svelte';

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
    previewRecords = [],
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
    previewRecords?: Array<{
      id: string;
      label: string;
      values?: Record<string, CustomPropertyValueCell>;
    }>;
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
  let formulaExpression = $state('');
  let initialFormulaExpression = $state('');
  let formulaSources = $state<FormulaSourceDescriptor[]>([]);
  let formulaCatalogRevision = $state('');
  let formulaAnalysis = $state<FormulaAnalysis | null>(null);
  let formulaCatalogBusy = $state(false);
  let formulaCatalogError = $state('');
  let formulaPreview = $state<FormulaPreviewResponse | null>(null);
  let formulaServerDiagnostics = $state<FormulaDiagnostic[]>([]);
  let formulaPreviewBusy = $state(false);
  let formulaPreviewSequence = 0;
  let presentation = $state<ColumnPresentation | null>(null);
  let confirmLifecycle = $state<CustomPropertyDefinition | null>(null);
  let openedKey = $state('');
  const inputValue = (event: Event) => (event.currentTarget as HTMLInputElement).value;

  const active = $derived(definitions.filter((definition) => !definition.archivedAt));
  const archived = $derived(definitions.filter((definition) => !!definition.archivedAt));
  const editing = $derived(
    editingId ? (definitions.find((definition) => definition.id === editingId) ?? null) : null,
  );
  function presentationValid(): boolean {
    if (!presentation || editing?.presentationRestricted) return true;
    if (
      !columnPresentationSchema.safeParse(presentation).success ||
      formulaAnalysis?.outputType?.kind !== 'number'
    )
      return false;
    const primaryMoney = formulaAnalysis.outputType.dimension === 'money';
    if (
      primaryMoney
        ? !['auto', 'currency'].includes(presentation.number.style)
        : presentation.number.style === 'currency'
    )
      return false;
    if (editing && JSON.stringify(presentation) === JSON.stringify(editing.presentation))
      return true;
    if (!presentation.secondary) return true;
    const secondary = definitions.find((item) => item.id === presentation?.secondary?.propertyId);
    if (
      !secondary ||
      secondary.archivedAt ||
      secondary.rules.type !== 'formula' ||
      secondary.rules.outputType.kind !== 'number'
    )
      return false;
    const secondaryMoney = secondary.rules.outputType.dimension === 'money';
    return secondaryMoney
      ? ['auto', 'currency'].includes(presentation.secondary.format.style)
      : presentation.secondary.format.style !== 'currency';
  }
  const formulaSaveBlocked = $derived(
    type === 'formula' &&
      (!formulaExpression.trim() ||
        formulaCatalogBusy ||
        !!formulaCatalogError ||
        !formulaCatalogRevision ||
        !formulaAnalysis ||
        !formulaAnalysis.outputType ||
        formulaAnalysis.diagnostics.some((item) => item.severity === 'error') ||
        formulaServerDiagnostics.some((item) => item.severity === 'error') ||
        !presentationValid()),
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
    if (value === 'multi_select') return m.custom_columns_type_multi_select();
    return m.custom_columns_type_formula();
  }

  function formulaOutputLabel(output: NonNullable<FormulaAnalysis['outputType']>): string {
    if (output.kind === 'text') return m.custom_columns_type_text();
    if (output.kind === 'boolean') return m.custom_columns_type_boolean();
    if (output.kind === 'date') return m.custom_columns_type_date();
    if (output.dimension === 'money')
      return m.custom_columns_formula_output_money({ currency: output.currency ?? '—' });
    if (output.dimension === 'percent') return m.custom_columns_formula_output_percent();
    return m.custom_columns_type_number();
  }

  function previewRecordLabel(recordId: string): string {
    return (
      previewRecords.find(({ id }) => id === recordId)?.label ?? m.custom_columns_formula_row()
    );
  }

  function previewSourceLabel(sourceId: string): string {
    return (
      formulaSources.find(({ id }) => id === sourceId)?.label ?? m.custom_columns_formula_source()
    );
  }

  function previewValue(value: string | number | boolean | null, currency?: string | null): string {
    return formatFormulaPreviewValue(
      value,
      formulaPreview?.outputType ?? null,
      languageTag(),
      { yes: m.common_yes(), no: m.common_no() },
      currency,
    );
  }

  function previewInputValue(sourceId: string, value: string | number | boolean | null): string {
    const source = formulaSources.find(({ id }) => id === sourceId);
    return formatFormulaPreviewValue(value, source?.type ?? null, languageTag(), {
      yes: m.common_yes(),
      no: m.common_no(),
    });
  }

  function previewResultValue(
    value: string | number | boolean | null,
    currency: string | null,
  ): string {
    if (presentation && formulaAnalysis?.outputType?.kind === 'number' && typeof value === 'number')
      return (
        formatPresentedNumber(
          value,
          presentation.number,
          formulaAnalysis.outputType,
          languageTag(),
          currency,
        ) ?? '—'
      );
    return previewValue(value, currency);
  }

  function previewQuality(quality: string): string | null {
    if (quality === 'partial') return m.custom_columns_formula_partial_dependency();
    if (quality === 'error') return m.custom_columns_formula_error();
    if (quality === 'restricted') return m.custom_columns_formula_restricted();
    if (quality === 'blank') return m.custom_columns_formula_preview_blank();
    return null;
  }

  function secondaryPreview(recordId: string): { text: string; state: string | null } | null {
    const secondary = presentation?.secondary;
    if (!secondary) return null;
    const definition = definitions.find((item) => item.id === secondary.propertyId);
    const cell = previewRecords.find((item) => item.id === recordId)?.values?.[
      secondary.propertyId
    ];
    if (
      !definition ||
      definition.rules.type !== 'formula' ||
      definition.rules.outputType.kind !== 'number' ||
      !cell
    )
      return { text: '—', state: m.custom_columns_format_secondary_unavailable() };
    const quality = cell.formula?.quality ?? 'blank';
    if (quality !== 'valid' || typeof cell.effectiveValue !== 'number')
      return { text: '—', state: previewQuality(quality) };
    return {
      text:
        formatPresentedNumber(
          cell.effectiveValue,
          secondary.format,
          definition.rules.outputType,
          languageTag(),
          cell.formula?.currency,
        ) ?? '—',
      state: null,
    };
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
    formulaExpression = '';
    initialFormulaExpression = '';
    formulaAnalysis = null;
    formulaPreview = null;
    presentation = null;
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
    formulaExpression =
      definition.rules.type === 'formula'
        ? formulaSources.length
          ? formatFormulaAst(definition.rules.ast, formulaSources)
          : definition.rules.expression
        : '';
    initialFormulaExpression = formulaExpression;
    presentation = definition.presentation
      ? {
          ...definition.presentation,
          number: { ...definition.presentation.number },
          secondary: definition.presentation.secondary
            ? {
                propertyId: definition.presentation.secondary.propertyId,
                format: { ...definition.presentation.secondary.format },
              }
            : null,
        }
      : null;
    if (definition.rules.type === 'formula') void ensureFormulaCatalog();
    error = '';
    mode = 'edit';
  }

  function rules(): CustomPropertyInputRules {
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
    if (type === 'multi_select')
      return {
        type,
        options,
        maxSelections: maxSelections === '' ? null : Number(maxSelections),
      };
    return { type: 'formula', expression: formulaExpression };
  }

  function defaultValue(): CustomPropertyValue {
    if (!hasDefault) return null;
    if (type === 'number') return defaultText === '' ? null : Number(defaultText);
    if (type === 'boolean') return defaultBool === '' ? null : defaultBool === 'true';
    if (type === 'select') return defaultOptions[0] ?? null;
    if (type === 'multi_select') return defaultOptions;
    return defaultText === '' ? null : defaultText;
  }

  function validate(): {
    rules: CustomPropertyInputRules;
    defaultValue: CustomPropertyValue;
  } | null {
    const nextRules = rules();
    if (!label.trim() || label.trim().length > CUSTOM_PROPERTY_LABEL_MAX) {
      error = m.custom_columns_invalid_name();
      return null;
    }
    if (description.length > CUSTOM_PROPERTY_DESCRIPTION_MAX) {
      error = m.custom_columns_invalid_description();
      return null;
    }
    if (nextRules.type === 'formula') {
      if (
        !nextRules.expression.trim() ||
        !formulaCatalogRevision ||
        !formulaAnalysis ||
        !formulaAnalysis.outputType ||
        formulaAnalysis.diagnostics.some((item) => item.severity === 'error') ||
        formulaServerDiagnostics.some((item) => item.severity === 'error') ||
        !presentationValid()
      ) {
        error = m.custom_columns_formula_invalid();
        return null;
      }
      return { rules: nextRules, defaultValue: null };
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

  function formulaDiagnostic(diagnostic: FormulaDiagnostic) {
    if (diagnostic.code === 'expression_too_long')
      return m.custom_columns_formula_expression_too_long();
    if (diagnostic.code === 'syntax_error') return m.custom_columns_formula_syntax_error();
    if (diagnostic.code === 'unknown_reference')
      return m.custom_columns_formula_unknown_reference();
    if (diagnostic.code === 'ambiguous_reference')
      return m.custom_columns_formula_ambiguous_reference();
    if (diagnostic.code === 'unknown_function') return m.custom_columns_formula_unknown_function();
    if (diagnostic.code === 'invalid_argument_count')
      return m.custom_columns_formula_invalid_argument_count();
    if (diagnostic.code === 'type_mismatch') return m.custom_columns_formula_type_mismatch();
    if (diagnostic.code === 'invalid_precision')
      return m.custom_columns_formula_invalid_precision();
    if (
      diagnostic.code === 'node_limit' ||
      diagnostic.code === 'depth_limit' ||
      diagnostic.code === 'expression_too_complex'
    )
      return m.custom_columns_formula_too_complex();
    if (diagnostic.code === 'dependency_limit') return m.custom_columns_formula_dependency_limit();
    if (diagnostic.code === 'numeric_out_of_range')
      return m.custom_columns_formula_numeric_out_of_range();
    if (diagnostic.code === 'formula_cycle') return m.custom_columns_formula_cycle();
    return m.custom_columns_formula_invalid();
  }

  async function ensureFormulaCatalog(force = false) {
    if (formulaCatalogBusy || (!force && (formulaCatalogRevision || formulaCatalogError))) return;
    const requestScope = scopeKey;
    formulaCatalogBusy = true;
    formulaCatalogError = '';
    try {
      const result = await loadFormulaCatalog(tableId);
      if (!isScopeCurrent(requestScope)) return;
      formulaSources = result.fields;
      formulaCatalogRevision = result.revision;
      if (editing?.rules.type === 'formula') {
        formulaExpression = formatFormulaAst(editing.rules.ast, result.fields);
        initialFormulaExpression = formulaExpression;
      }
    } catch {
      if (isScopeCurrent(requestScope))
        formulaCatalogError = m.custom_columns_formula_catalog_failed();
    } finally {
      if (isScopeCurrent(requestScope)) formulaCatalogBusy = false;
    }
  }

  async function runFormulaPreview() {
    if (
      !formulaExpression.trim() ||
      formulaAnalysis?.diagnostics.some((item) => item.severity === 'error')
    )
      return;
    const requestScope = scopeKey;
    const requestExpression = formulaExpression;
    const requestEditingId = editingId;
    const requestRevision = formulaCatalogRevision;
    const request = ++formulaPreviewSequence;
    formulaPreviewBusy = true;
    error = '';
    try {
      const response = await previewFormula({
        tableId,
        expression: requestExpression,
        recordIds: previewRecords.slice(0, 20).map(({ id }) => id),
        ...(requestEditingId ? { propertyId: requestEditingId } : {}),
        catalogRevision: requestRevision,
      });
      if (
        !isScopeCurrent(requestScope) ||
        request !== formulaPreviewSequence ||
        formulaExpression !== requestExpression ||
        editingId !== requestEditingId ||
        formulaCatalogRevision !== requestRevision
      )
        return;
      formulaPreview = response;
      formulaServerDiagnostics = response.diagnostics;
    } catch (cause) {
      if (
        cause instanceof CustomPropertyHttpError &&
        cause.status === 409 &&
        cause.code === 'catalog_changed'
      ) {
        try {
          const catalog = await loadFormulaCatalog(tableId);
          if (!isScopeCurrent(requestScope) || request !== formulaPreviewSequence) return;
          formulaSources = catalog.fields;
          formulaCatalogRevision = catalog.revision;
        } catch {
          // Preserve the preview failure and draft when authoritative catalog reload also fails.
        }
      }
      if (isScopeCurrent(requestScope) && request === formulaPreviewSequence)
        error = m.custom_columns_formula_preview_failed();
    } finally {
      if (isScopeCurrent(requestScope) && request === formulaPreviewSequence)
        formulaPreviewBusy = false;
    }
  }

  $effect(() => {
    if (type === 'formula' && open) void ensureFormulaCatalog();
  });

  async function save() {
    const valid = validate();
    if (!valid) return;
    busy = true;
    const requestScope = scopeKey;
    error = '';
    const base = editing;
    const existingIds = new Set(definitions.map((definition) => definition.id));
    const formulaChanged =
      type === 'formula' && (!base || formulaExpression.trim() !== initialFormulaExpression.trim());
    const presentationChanged =
      type === 'formula' &&
      (!base || JSON.stringify(presentation) !== JSON.stringify(base.presentation));
    const requested = {
      label: label.trim(),
      description: description.trim() || null,
      hasDefault: type === 'formula' ? false : hasDefault,
      defaultValue: valid.defaultValue,
      ...(!base || type !== 'formula' || formulaChanged ? { rules: valid.rules } : {}),
      ...(type === 'formula' && (formulaChanged || presentationChanged)
        ? { catalogRevision: formulaCatalogRevision }
        : {}),
      ...(type === 'formula' && presentationChanged && !base?.presentationRestricted
        ? { presentation }
        : {}),
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
          rules: valid.rules,
        };
        saved = await actions.create(input);
      }
      if (!isScopeCurrent(requestScope)) return;
      onchanged(saved);
      mode = 'list';
      resetDraft();
    } catch (cause) {
      if (
        cause instanceof CustomPropertyHttpError &&
        cause.status === 409 &&
        cause.code === 'catalog_changed'
      ) {
        try {
          const catalog = await loadFormulaCatalog(tableId);
          if (!isScopeCurrent(requestScope)) return;
          formulaSources = catalog.fields;
          formulaCatalogRevision = catalog.revision;
        } catch {
          // Keep the conflict visible; the user can retry catalog loading without losing the draft.
        }
      }
      try {
        const refreshed = await actions.list(tableId);
        if (!isScopeCurrent(requestScope)) return;
        onloaded(refreshed);
        const requestedRules = 'rules' in requested ? requested.rules : undefined;
        const matches = (entry: CustomPropertyDefinition) =>
          entry.label === requested.label &&
          entry.description === requested.description &&
          (!requestedRules ||
            (requestedRules.type === 'formula'
              ? entry.rules.type === 'formula' &&
                entry.rules.expression === requestedRules.expression
              : JSON.stringify(entry.rules) === JSON.stringify(requestedRules))) &&
          entry.hasDefault === requested.hasDefault &&
          JSON.stringify(entry.defaultValue) === JSON.stringify(requested.defaultValue) &&
          (!('presentation' in requested) ||
            JSON.stringify(entry.presentation) === JSON.stringify(requested.presentation));
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
        color: CUSTOM_PROPERTY_COLORS[options.length % CUSTOM_PROPERTY_COLORS.length],
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
            <Select {...p} size="sm" options={typeOptions} bind:value={type} disabled={!!editing} />
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
      {:else if type === 'formula'}
        <section class="formula-block">
          <FormField label={m.custom_columns_formula_expression()} required>
            {#snippet children(p)}
              <div {...p}>
                <FormulaEditor
                  bind:value={formulaExpression}
                  sources={formulaSources}
                  placeholder={m.custom_columns_formula_placeholder()}
                  diagnosticMessage={formulaDiagnostic}
                  onanalysis={(analysis) => {
                    formulaAnalysis = analysis;
                    if (
                      analysis.outputType &&
                      analysis.outputType.kind !== 'number' &&
                      !analysis.diagnostics.some((item) => item.severity === 'error')
                    )
                      presentation = null;
                    formulaPreviewSequence++;
                    formulaPreviewBusy = false;
                    formulaServerDiagnostics = [];
                    formulaPreview = null;
                  }}
                />
              </div>
            {/snippet}
          </FormField>
          <p class="t-caption">{m.custom_columns_formula_hint()}</p>
          {#if formulaAnalysis?.diagnostics.length}
            <div class="formula-diagnostics" role="alert">
              {#each formulaAnalysis.diagnostics as diagnostic, index (`${diagnostic.code}:${diagnostic.from}:${diagnostic.to}:${index}`)}
                <p class:formula-preview-warning={diagnostic.severity === 'warning'}>
                  {formulaDiagnostic(diagnostic)}
                </p>
              {/each}
            </div>
          {/if}
          {#if formulaCatalogBusy}<p class="t-caption">{m.custom_columns_formula_loading()}</p>{/if}
          {#if formulaCatalogError}
            <div class="formula-load-error" role="alert">
              <span>{formulaCatalogError}</span>
              <Button
                variant="ghost"
                size="xs"
                type="button"
                onclick={() => void ensureFormulaCatalog(true)}>{m.asyncAction_retry()}</Button
              >
            </div>
          {/if}
          {#if formulaAnalysis?.outputType}
            <p class="t-caption">
              {m.custom_columns_formula_output({
                type: formulaOutputLabel(formulaAnalysis.outputType),
              })}
            </p>
          {/if}
          <Button
            variant="outline"
            size="sm"
            type="button"
            loading={formulaPreviewBusy}
            disabled={formulaPreviewBusy ||
              !formulaCatalogRevision ||
              !previewRecords.length ||
              !!formulaAnalysis?.diagnostics.some((item) => item.severity === 'error')}
            onclick={() => void runFormulaPreview()}>{m.custom_columns_formula_preview()}</Button
          >
          {#if formulaPreview}
            <div class="formula-preview">
              {#each formulaPreview.diagnostics as diagnostic, index (`${diagnostic.code}:${diagnostic.from}:${diagnostic.to}:${index}`)}
                <p
                  class:formula-preview-warning={diagnostic.severity === 'warning'}
                  class="form-error"
                >
                  {formulaDiagnostic(diagnostic)}
                </p>
              {/each}
              {#each formulaPreview.rows as row (row.recordId)}
                <div class="preview-row">
                  <strong>{previewRecordLabel(row.recordId)}</strong>
                  <span class="preview-result">
                    {m.custom_columns_formula_preview_result()}:
                    <span
                      class:tone-positive={presentedTone(
                        row.result.value,
                        row.result.formula.quality,
                        presentation,
                      ) === 'positive'}
                      class:tone-negative={presentedTone(
                        row.result.value,
                        row.result.formula.quality,
                        presentation,
                      ) === 'negative'}
                      >{previewResultValue(row.result.value, row.result.formula.currency)}</span
                    >
                  </span>
                  {#if previewQuality(row.result.formula.quality)}
                    <span class="formula-warning">{previewQuality(row.result.formula.quality)}</span
                    >
                  {/if}
                  <div class="preview-inputs">
                    {#each Object.entries(row.inputs) as [sourceId, value] (sourceId)}
                      <span class="t-caption">
                        {previewSourceLabel(sourceId)}: {previewInputValue(sourceId, value)}
                      </span>
                    {/each}
                  </div>
                  {#if row.nativeComparison}
                    <span class="t-caption">
                      {m.custom_columns_formula_preview_native()}:
                      {previewValue(row.nativeComparison.value, row.result.formula.currency)}
                      {#if row.nativeComparison.status === 'match'}
                        · {m.custom_columns_formula_preview_match()}
                      {:else if row.nativeComparison.status === 'different'}
                        · {m.custom_columns_formula_delta({
                          value: previewValue(
                            row.nativeComparison.delta,
                            row.result.formula.currency,
                          ),
                        })}
                      {:else}
                        · {m.custom_columns_formula_preview_unavailable()}
                      {/if}
                    </span>
                  {/if}
                  {#if presentation?.secondary}
                    {@const secondary = secondaryPreview(row.recordId)}
                    {#if secondary}
                      <span class="t-caption">
                        {m.custom_columns_format_secondary()}: {secondary.text}
                        {#if secondary.state}
                          · {secondary.state}{/if}
                      </span>
                    {/if}
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
          {#if formulaAnalysis?.outputType}
            <ColumnPresentationEditor
              value={presentation}
              output={formulaAnalysis.outputType}
              {definitions}
              availablePropertyIds={new Set(
                formulaSources.flatMap((source) =>
                  source.source === 'native'
                    ? []
                    : [source.id, source.id.replace(/^property:/, '')],
                ),
              )}
              currentId={editingId}
              disabled={busy}
              restricted={editing?.presentationRestricted ?? false}
              onchange={(next) => (presentation = next)}
            />
            {#if !presentationValid()}<p class="form-error" role="alert">
                {m.custom_columns_format_invalid()}
              </p>{/if}
          {/if}
        </section>
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
                {#each CUSTOM_PROPERTY_COLORS as color, index (color)}
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

      {#if type !== 'formula'}<div class="default-block">
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
        </div>{/if}

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
          disabled={!canManage || busy || formulaSaveBlocked}>{m.common_save()}</Button
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
  .formula-block,
  .formula-preview {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .formula-load-error {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    color: var(--color-danger-fg);
  }
  .formula-diagnostics {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    color: var(--color-danger-fg);
  }
  .formula-diagnostics p {
    margin: 0;
  }
  .formula-preview {
    max-height: calc(var(--space-12) * 4);
    overflow: auto;
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }
  .preview-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--color-border);
  }
  .preview-inputs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .preview-result {
    color: var(--color-text-primary);
  }
  .tone-positive {
    color: var(--color-success-fg);
  }
  .tone-negative {
    color: var(--color-danger-fg);
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
