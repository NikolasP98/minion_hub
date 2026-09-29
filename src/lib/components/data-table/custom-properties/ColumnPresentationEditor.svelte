<script lang="ts">
  import { Input, Select, Toggle } from '$lib/components/ui';
  import { FormField } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';
  import type { CustomPropertyDefinition } from '$lib/tables/custom-properties';
  import {
    primaryFormulaVariable,
    type FormulaNumberType,
    type FormulaScalarType,
  } from '$lib/tables/formula';
  import {
    DEFAULT_COLUMN_PRESENTATION,
    type ColumnPresentation,
  } from '$lib/tables/column-presentation';
  import { formatPresentedNumber } from '$lib/tables/column-presentation-display';
  import { languageTag } from '$lib/paraglide/runtime';

  let {
    value,
    output,
    definitions,
    availablePropertyIds,
    currentId,
    disabled = false,
    restricted = false,
    onchange,
  }: {
    value: ColumnPresentation | null;
    output: FormulaScalarType;
    definitions: CustomPropertyDefinition[];
    availablePropertyIds: ReadonlySet<string>;
    currentId: string | null;
    disabled?: boolean;
    restricted?: boolean;
    onchange: (value: ColumnPresentation | null) => void;
  } = $props();
  const formulaNumberOutput = (item: CustomPropertyDefinition): FormulaNumberType | null => {
    if (item.rules.type !== 'formula') return null;
    const output = primaryFormulaVariable(item.rules, item.id).outputType;
    return output.kind === 'number' ? output : null;
  };
  const numberOutput = $derived(output.kind === 'number' ? output : null);
  const secondaryOptions = $derived([
    { value: '', label: m.custom_columns_format_secondary_none() },
    ...definitions
      .filter(
        (item) =>
          item.id !== currentId &&
          !item.archivedAt &&
          availablePropertyIds.has(item.id) &&
          !!formulaNumberOutput(item),
      )
      .map((item) => ({ value: item.id, label: item.label })),
    ...(value?.secondary &&
    !definitions.some(
      (item) =>
        item.id === value.secondary?.propertyId &&
        !item.archivedAt &&
        availablePropertyIds.has(item.id) &&
        !!formulaNumberOutput(item),
    )
      ? [
          {
            value: value.secondary.propertyId,
            label: m.custom_columns_format_secondary_unavailable(),
          },
        ]
      : []),
  ]);
  const secondaryDefinition = $derived(
    value?.secondary
      ? (definitions.find((item) => item.id === value.secondary?.propertyId) ?? null)
      : null,
  );
  const secondaryOutput = $derived(
    secondaryDefinition?.rules.type === 'formula' &&
      !secondaryDefinition.archivedAt &&
      availablePropertyIds.has(secondaryDefinition.id)
      ? formulaNumberOutput(secondaryDefinition)
      : null,
  );
  const styleOptions = $derived(
    numberOutput?.dimension === 'money'
      ? [
          { value: 'auto', label: m.custom_columns_format_style_auto() },
          { value: 'currency', label: m.custom_columns_format_style_currency() },
        ]
      : [
          { value: 'auto', label: m.custom_columns_format_style_auto() },
          { value: 'decimal', label: m.custom_columns_format_style_decimal() },
          { value: 'percent', label: m.custom_columns_format_style_percent() },
        ],
  );
  function update(patch: Partial<ColumnPresentation>) {
    if (value) onchange({ ...value, ...patch });
  }
  function updateNumber(patch: Partial<ColumnPresentation['number']>) {
    if (value) update({ number: { ...value.number, ...patch } });
  }
  function updateSecondary(patch: Partial<ColumnPresentation['number']>) {
    if (value?.secondary)
      update({
        secondary: { ...value.secondary, format: { ...value.secondary.format, ...patch } },
      });
  }
  const preview = $derived(
    value && numberOutput
      ? formatPresentedNumber(
          1234.5,
          value.number,
          numberOutput,
          languageTag(),
          numberOutput.currency,
        )
      : null,
  );
</script>

<section class="presentation-block">
  <div class="presentation-heading">
    <div>
      <strong>{m.custom_columns_format_title()}</strong>
      <p class="t-caption">{m.custom_columns_format_hint()}</p>
    </div>
    <Toggle
      ariaLabel={m.custom_columns_format_title()}
      checked={!!value}
      disabled={disabled || restricted || !numberOutput}
      onchange={(checked) =>
        onchange(
          checked
            ? { ...DEFAULT_COLUMN_PRESENTATION, number: { ...DEFAULT_COLUMN_PRESENTATION.number } }
            : null,
        )}
    />
  </div>
  {#if restricted}<p class="format-warning">{m.custom_columns_format_restricted()}</p>{/if}
  {#if value && numberOutput}
    <div class="format-grid">
      <FormField label={m.custom_columns_format_style()}
        >{#snippet children(p)}<Select
            {...p}
            size="sm"
            options={styleOptions}
            value={value.number.style}
            disabled={disabled || restricted}
            onchange={(next) =>
              updateNumber({ style: next as ColumnPresentation['number']['style'] })}
          />{/snippet}</FormField
      >
      <FormField label={m.custom_columns_format_decimals()}
        >{#snippet children(p)}<Input
            {...p}
            size="sm"
            type="number"
            min="0"
            max="6"
            disabled={disabled || restricted}
            value={value.number.decimals == null ? '' : String(value.number.decimals)}
            oninput={(event) =>
              updateNumber({
                decimals:
                  (event.currentTarget as HTMLInputElement).value === ''
                    ? null
                    : Number((event.currentTarget as HTMLInputElement).value),
              })}
          />{/snippet}</FormField
      >
      {#if value.number.style === 'currency' || (value.number.style === 'auto' && numberOutput.dimension === 'money')}
        <FormField label={m.custom_columns_format_currency_display()}
          >{#snippet children(p)}<Select
              {...p}
              size="sm"
              disabled={disabled || restricted}
              value={value.number.currencyDisplay}
              options={[
                { value: 'symbol', label: m.custom_columns_format_currency_symbol() },
                { value: 'code', label: m.custom_columns_format_currency_code() },
              ]}
              onchange={(next) => updateNumber({ currencyDisplay: next as 'symbol' | 'code' })}
            />{/snippet}</FormField
        >
      {/if}
      {#if value.number.style === 'percent'}
        <FormField label={m.custom_columns_format_percent_scale()}
          >{#snippet children(p)}<Select
              {...p}
              size="sm"
              disabled={disabled || restricted}
              value={value.number.percentScale}
              options={[
                { value: 'whole', label: m.custom_columns_format_percent_whole() },
                { value: 'ratio', label: m.custom_columns_format_percent_ratio() },
              ]}
              onchange={(next) => updateNumber({ percentScale: next as 'whole' | 'ratio' })}
            />{/snippet}</FormField
        >
      {/if}
      <FormField label={m.custom_columns_format_secondary()}
        >{#snippet children(p)}<Select
            {...p}
            size="sm"
            disabled={disabled || restricted}
            value={value.secondary?.propertyId ?? ''}
            options={secondaryOptions}
            onchange={(next) =>
              update({
                secondary: next
                  ? { propertyId: String(next), format: { ...DEFAULT_COLUMN_PRESENTATION.number } }
                  : null,
              })}
          />{/snippet}</FormField
      >
    </div>
    {#if value.secondary}
      {@const secondaryFormat = value.secondary.format}
      {#if secondaryOutput}
        <fieldset class="secondary-format">
          <legend>{m.custom_columns_format_secondary_format()}</legend>
          <div class="format-grid">
            <FormField label={m.custom_columns_format_style()}
              >{#snippet children(p)}<Select
                  {...p}
                  size="sm"
                  disabled={disabled || restricted}
                  value={secondaryFormat.style}
                  options={secondaryOutput.dimension === 'money'
                    ? [
                        { value: 'auto', label: m.custom_columns_format_style_auto() },
                        { value: 'currency', label: m.custom_columns_format_style_currency() },
                      ]
                    : [
                        { value: 'auto', label: m.custom_columns_format_style_auto() },
                        { value: 'decimal', label: m.custom_columns_format_style_decimal() },
                        { value: 'percent', label: m.custom_columns_format_style_percent() },
                      ]}
                  onchange={(next) =>
                    updateSecondary({ style: next as ColumnPresentation['number']['style'] })}
                />{/snippet}</FormField
            >
            <FormField label={m.custom_columns_format_decimals()}
              >{#snippet children(p)}<Input
                  {...p}
                  size="sm"
                  type="number"
                  min="0"
                  max="6"
                  disabled={disabled || restricted}
                  value={secondaryFormat.decimals == null ? '' : String(secondaryFormat.decimals)}
                  oninput={(event) =>
                    updateSecondary({
                      decimals:
                        (event.currentTarget as HTMLInputElement).value === ''
                          ? null
                          : Number((event.currentTarget as HTMLInputElement).value),
                    })}
                />{/snippet}</FormField
            >
            {#if secondaryFormat.style === 'percent'}
              <FormField label={m.custom_columns_format_percent_scale()}
                >{#snippet children(p)}<Select
                    {...p}
                    size="sm"
                    disabled={disabled || restricted}
                    value={secondaryFormat.percentScale}
                    options={[
                      { value: 'whole', label: m.custom_columns_format_percent_whole() },
                      { value: 'ratio', label: m.custom_columns_format_percent_ratio() },
                    ]}
                    onchange={(next) =>
                      updateSecondary({ percentScale: next as 'whole' | 'ratio' })}
                  />{/snippet}</FormField
              >
            {/if}
            {#if secondaryFormat.style === 'currency' || (secondaryFormat.style === 'auto' && secondaryOutput.dimension === 'money')}
              <FormField label={m.custom_columns_format_currency_display()}
                >{#snippet children(p)}<Select
                    {...p}
                    size="sm"
                    disabled={disabled || restricted}
                    value={secondaryFormat.currencyDisplay}
                    options={[
                      { value: 'symbol', label: m.custom_columns_format_currency_symbol() },
                      { value: 'code', label: m.custom_columns_format_currency_code() },
                    ]}
                    onchange={(next) =>
                      updateSecondary({ currencyDisplay: next as 'symbol' | 'code' })}
                  />{/snippet}</FormField
              >
            {/if}
          </div>
        </fieldset>
      {:else}<p class="format-warning">{m.custom_columns_format_secondary_unavailable()}</p>{/if}
    {/if}
    <label class="tone-row"
      ><Toggle
        ariaLabel={m.custom_columns_format_sign_colors()}
        checked={value.tone === 'sign'}
        disabled={disabled || restricted}
        onchange={(checked) => update({ tone: checked ? 'sign' : 'none' })}
      /><span>{m.custom_columns_format_sign_colors()}</span></label
    >
    <p class="format-preview">
      {m.custom_columns_format_preview()}: <strong>{preview ?? '—'}</strong>
    </p>
  {/if}
</section>

<style>
  .presentation-block {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
  }
  .presentation-heading,
  .tone-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .presentation-heading p {
    margin: 0;
  }
  .format-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }
  .format-warning {
    color: var(--color-warning-fg);
  }
  .secondary-format {
    margin: 0;
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }
  .format-preview {
    margin: 0;
    color: var(--color-text-secondary);
  }
</style>
