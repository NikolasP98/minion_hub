<script lang="ts">
  import { ArrowLeft, ArrowRight, GripVertical, Plus, Trash2 } from 'lucide-svelte';
  import { Button, Input, Select, iconSizes } from '$lib/components/ui';
  import { FormField } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';
  import {
    FORMULA_VARIABLE_NAME_MAX,
    FORMULA_VARIABLES_MAX,
    type FormulaAnalysis,
    type FormulaDiagnostic,
    type FormulaSourceDescriptor,
    type FormulaVariableDraft,
  } from '$lib/tables/formula';
  import FormulaEditor from './FormulaEditor.svelte';

  let {
    variables,
    primaryVariableId,
    sources,
    disabled = false,
    diagnosticMessage,
    onchange,
    onanalysis,
    onannounce,
  }: {
    variables: FormulaVariableDraft[];
    primaryVariableId: string;
    sources: FormulaSourceDescriptor[];
    disabled?: boolean;
    diagnosticMessage: (diagnostic: FormulaDiagnostic) => string;
    onchange: (variables: FormulaVariableDraft[], primaryVariableId: string) => void;
    onanalysis: (id: string, analysis: FormulaAnalysis) => void;
    onannounce: (message: string) => void;
  } = $props();
  let draggedId = $state<string | null>(null);
  const complex = $derived(variables.length > 1);
  const primaryOptions = $derived(
    variables.map((item, index) => ({
      value: item.id,
      label: item.name?.trim() || m.custom_columns_variable_position({ position: index + 1 }),
    })),
  );
  const canonicalName = (value: string | null | undefined) =>
    value?.normalize('NFKC').trim().toLocaleLowerCase() ?? '';

  function patch(id: string, next: Partial<FormulaVariableDraft>) {
    if (disabled) return;
    onchange(
      variables.map((item) => (item.id === id ? { ...item, ...next } : item)),
      primaryVariableId,
    );
  }
  function add() {
    if (disabled || variables.length >= FORMULA_VARIABLES_MAX) return;
    const used = new Set(variables.map((item) => canonicalName(item.name)).filter(Boolean));
    let position = variables.length + 1;
    let name = m.custom_columns_variable_default_name({ position });
    while (used.has(canonicalName(name)))
      name = m.custom_columns_variable_default_name({ position: ++position });
    const next = [
      ...variables.map((item, index) => ({
        ...item,
        name: item.name ?? m.custom_columns_variable_default_name({ position: index + 1 }),
      })),
      { id: crypto.randomUUID(), name, expression: '' },
    ];
    onchange(next, primaryVariableId || next[0].id);
  }
  function remove(id: string) {
    if (disabled || variables.length <= 1 || id === primaryVariableId) return;
    const next = variables.filter((item) => item.id !== id);
    onchange(next.length === 1 ? [{ ...next[0], name: null }] : next, primaryVariableId);
  }
  function move(id: string, delta: number) {
    if (disabled) return;
    const from = variables.findIndex((item) => item.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= variables.length) return;
    const next = [...variables];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onchange(next, primaryVariableId);
    onannounce(m.custom_columns_variable_moved({ position: to + 1, total: next.length }));
  }
  function drop(targetId: string) {
    if (disabled || !draggedId || draggedId === targetId) return;
    const from = variables.findIndex((item) => item.id === draggedId);
    const to = variables.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...variables];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onchange(next, primaryVariableId);
    onannounce(m.custom_columns_variable_moved({ position: to + 1, total: next.length }));
    draggedId = null;
  }
</script>

<section class="variables-block">
  <div class="variables-head">
    <div>
      <h3 class="t-section">{m.custom_columns_variables()}</h3>
      <p class="t-caption">{m.custom_columns_variables_hint()}</p>
    </div>
    <Button
      variant="outline"
      size="sm"
      disabled={disabled || variables.length >= FORMULA_VARIABLES_MAX}
      onclick={add}><Plus size={iconSizes.xs} />{m.custom_columns_variable_add()}</Button
    >
  </div>
  {#if complex}<FormField label={m.custom_columns_variable_primary()}
      >{#snippet children(p)}<Select
          {...p}
          size="sm"
          options={primaryOptions}
          value={primaryVariableId}
          {disabled}
          onchange={(value) => onchange(variables, String(value))}
        />{/snippet}</FormField
    >{/if}
  <div class="variable-list">
    {#each variables as variable, index (variable.id)}
      <article
        class="variable-card"
        ondragover={(event) => event.preventDefault()}
        ondrop={() => drop(variable.id)}
      >
        <div class="variable-head">
          <span
            class="drag"
            draggable={!disabled}
            ondragstart={() => {
              if (!disabled) draggedId = variable.id;
            }}
            ondragend={() => (draggedId = null)}
            aria-hidden="true"><GripVertical size={iconSizes.sm} /></span
          ><strong
            >{complex
              ? variable.name || m.custom_columns_variable_position({ position: index + 1 })
              : m.custom_columns_variable_single()}</strong
          >
          <div class="move-actions">
            <Button
              variant="ghost"
              size="xs"
              aria-label={m.custom_columns_variable_move_left()}
              disabled={disabled || index === 0}
              onclick={() => move(variable.id, -1)}><ArrowLeft size={iconSizes.xs} /></Button
            ><Button
              variant="ghost"
              size="xs"
              aria-label={m.custom_columns_variable_move_right()}
              disabled={disabled || index === variables.length - 1}
              onclick={() => move(variable.id, 1)}><ArrowRight size={iconSizes.xs} /></Button
            ><Button
              variant="ghost"
              size="xs"
              aria-label={m.custom_columns_variable_remove()}
              disabled={disabled || variables.length === 1 || variable.id === primaryVariableId}
              onclick={() => remove(variable.id)}><Trash2 size={iconSizes.xs} /></Button
            >
          </div>
        </div>
        {#if complex}<FormField label={m.custom_columns_variable_name()} required
            >{#snippet children(p)}<Input
                {...p}
                size="sm"
                maxlength={FORMULA_VARIABLE_NAME_MAX}
                value={variable.name ?? ''}
                {disabled}
                oninput={(event) =>
                  patch(variable.id, { name: (event.currentTarget as HTMLInputElement).value })}
              />{/snippet}</FormField
          >{/if}
        <FormField label={m.custom_columns_formula_expression()} required
          >{#snippet children(p)}<div {...p}>
              <FormulaEditor
                value={variable.expression}
                {sources}
                {disabled}
                placeholder={m.custom_columns_formula_placeholder()}
                {diagnosticMessage}
                onvaluechange={(expression) => patch(variable.id, { expression })}
                onanalysis={(analysis) => onanalysis(variable.id, analysis)}
              />
            </div>{/snippet}</FormField
        >
      </article>
    {/each}
  </div>
</section>

<style>
  .variables-block,
  .variable-list,
  .variable-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .variables-head,
  .variable-head,
  .move-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .variables-head,
  .variable-head {
    justify-content: space-between;
  }
  .variables-head p {
    margin: 0;
  }
  .variable-card {
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
  }
  .drag {
    display: inline-flex;
    color: var(--color-text-tertiary);
    cursor: grab;
  }
  .move-actions {
    margin-left: auto;
  }
</style>
