<script lang="ts">
  import { Input, Select, Toggle } from '$lib/components/ui';
  import { FormField } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';
  import { languageTag } from '$lib/paraglide/runtime';
  import {
    defaultVariablePresentation,
    type ColumnPresentationV2,
    type ColumnVariablePresentation,
  } from '$lib/tables/column-presentation';
  import { formatPresentedNumber } from '$lib/tables/column-presentation-display';
  import type { FormulaAnalysis, FormulaVariableDraft } from '$lib/tables/formula';

  let {
    value,
    variables,
    analyses,
    primaryVariableId,
    disabled = false,
    restricted = false,
    onchange,
  }: {
    value: ColumnPresentationV2 | null;
    variables: FormulaVariableDraft[];
    analyses: Record<string, FormulaAnalysis>;
    primaryVariableId: string;
    disabled?: boolean;
    restricted?: boolean;
    onchange: (value: ColumnPresentationV2 | null) => void;
  } = $props();
  function entries() {
    const byId = new Map(value?.variables.map((item) => [item.variableId, item]));
    return variables.map(
      (item) =>
        byId.get(item.id) ?? defaultVariablePresentation(item.id, item.id === primaryVariableId),
    );
  }
  function update(variableId: string, patch: Partial<ColumnVariablePresentation>) {
    onchange({
      version: 2,
      variables: entries().map((item) =>
        item.variableId === variableId ? { ...item, ...patch } : item,
      ),
    });
  }
  function updateNumber(
    variableId: string,
    patch: Partial<NonNullable<ColumnVariablePresentation['number']>>,
  ) {
    const current = entries().find((item) => item.variableId === variableId);
    if (current?.number) update(variableId, { number: { ...current.number, ...patch } });
  }
  const styleOptions = (money: boolean) =>
    money
      ? [
          { value: 'auto', label: m.custom_columns_format_style_auto() },
          { value: 'currency', label: m.custom_columns_format_style_currency() },
        ]
      : [
          { value: 'auto', label: m.custom_columns_format_style_auto() },
          { value: 'decimal', label: m.custom_columns_format_style_decimal() },
          { value: 'percent', label: m.custom_columns_format_style_percent() },
        ];
</script>

<section class="presentation-block">
  <div class="presentation-heading">
    <div>
      <h3 class="t-section">{m.custom_columns_format_title()}</h3>
      <p class="t-caption">{m.custom_columns_format_hint()}</p>
    </div>
    <Toggle
      ariaLabel={m.custom_columns_format_title()}
      checked={!!value}
      disabled={disabled || restricted}
      onchange={(checked) => onchange(checked ? { version: 2, variables: entries() } : null)}
    />
  </div>
  {#if restricted}<p class="format-warning">{m.custom_columns_format_restricted()}</p>{/if}
  {#if value}
    <div class="format-list">
      {#each variables as variable, index (variable.id)}
        {@const entry = entries().find((item) => item.variableId === variable.id)!}
        {@const output = analyses[variable.id]?.outputType}
        <fieldset class="format-card">
          <legend
            >{variable.name || m.custom_columns_variable_position({ position: index + 1 })}</legend
          >
          <FormField label={m.custom_columns_variable_emphasis()}
            >{#snippet children(p)}<Select
                {...p}
                size="sm"
                disabled={disabled || restricted}
                value={entry.emphasis}
                options={[
                  { value: 'normal', label: m.custom_columns_variable_emphasis_normal() },
                  { value: 'muted', label: m.custom_columns_variable_emphasis_muted() },
                ]}
                onchange={(next) =>
                  update(variable.id, { emphasis: String(next) as 'normal' | 'muted' })}
              />{/snippet}</FormField
          >
          {#if output?.kind === 'number' && entry.number}
            {@const number = entry.number}
            <div class="format-grid">
              <FormField label={m.custom_columns_format_style()}
                >{#snippet children(p)}<Select
                    {...p}
                    size="sm"
                    disabled={disabled || restricted}
                    value={number.style}
                    options={styleOptions(output.dimension === 'money')}
                    onchange={(next) =>
                      updateNumber(variable.id, {
                        style: String(next) as NonNullable<
                          ColumnVariablePresentation['number']
                        >['style'],
                      })}
                  />{/snippet}</FormField
              ><FormField label={m.custom_columns_format_decimals()}
                >{#snippet children(p)}<Input
                    {...p}
                    size="sm"
                    type="number"
                    min="0"
                    max="6"
                    disabled={disabled || restricted}
                    value={number.decimals == null ? '' : String(number.decimals)}
                    oninput={(event) =>
                      updateNumber(variable.id, {
                        decimals:
                          (event.currentTarget as HTMLInputElement).value === ''
                            ? null
                            : Number((event.currentTarget as HTMLInputElement).value),
                      })}
                  />{/snippet}</FormField
              >
            </div>
            {#if number.style === 'currency' || (number.style === 'auto' && output.dimension === 'money')}<FormField
                label={m.custom_columns_format_currency_display()}
                >{#snippet children(p)}<Select
                    {...p}
                    size="sm"
                    disabled={disabled || restricted}
                    value={number.currencyDisplay}
                    options={[
                      { value: 'symbol', label: m.custom_columns_format_currency_symbol() },
                      { value: 'code', label: m.custom_columns_format_currency_code() },
                    ]}
                    onchange={(next) =>
                      updateNumber(variable.id, {
                        currencyDisplay: String(next) as 'symbol' | 'code',
                      })}
                  />{/snippet}</FormField
              >{/if}
            {#if number.style === 'percent'}<FormField
                label={m.custom_columns_format_percent_scale()}
                >{#snippet children(p)}<Select
                    {...p}
                    size="sm"
                    disabled={disabled || restricted}
                    value={number.percentScale}
                    options={[
                      { value: 'whole', label: m.custom_columns_format_percent_whole() },
                      { value: 'ratio', label: m.custom_columns_format_percent_ratio() },
                    ]}
                    onchange={(next) =>
                      updateNumber(variable.id, {
                        percentScale: String(next) as 'whole' | 'ratio',
                      })}
                  />{/snippet}</FormField
              >{/if}
            <label class="tone-row"
              ><Toggle
                ariaLabel={m.custom_columns_format_sign_colors()}
                checked={entry.tone === 'sign'}
                disabled={disabled || restricted}
                onchange={(checked) => update(variable.id, { tone: checked ? 'sign' : 'none' })}
              /><span>{m.custom_columns_format_sign_colors()}</span></label
            >
            <p class="t-caption">
              {m.custom_columns_format_preview()}: {formatPresentedNumber(
                1234.5,
                number,
                output,
                languageTag(),
                output.currency,
              ) ?? '—'}
            </p>
          {/if}
        </fieldset>
      {/each}
    </div>
  {/if}
</section>

<style>
  .presentation-block,
  .format-list,
  .format-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .presentation-block,
  .format-card {
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }
  .presentation-block {
    background: var(--color-surface-2);
  }
  .format-card {
    background: var(--color-surface-1);
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
</style>
