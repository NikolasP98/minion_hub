<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { autocompletion } from '@codemirror/autocomplete';
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import { setDiagnostics } from '@codemirror/lint';
  import { Compartment, EditorState } from '@codemirror/state';
  import { EditorView, keymap, placeholder as placeholderExtension } from '@codemirror/view';
  import type {
    FormulaAnalysis,
    FormulaDiagnostic,
    FormulaSourceDescriptor,
  } from '$lib/tables/formula';
  import {
    analyzeFormulaDraft,
    formulaCompletionSource,
    formulaEditorDiagnostics,
  } from './formula-editor';

  let {
    value = $bindable(''),
    sources,
    placeholder = '',
    disabled = false,
    diagnosticMessage,
    onanalysis,
    onvaluechange,
  }: {
    value?: string;
    sources: FormulaSourceDescriptor[];
    placeholder?: string;
    disabled?: boolean;
    diagnosticMessage: (diagnostic: FormulaDiagnostic) => string;
    onanalysis?: (analysis: FormulaAnalysis) => void;
    onvaluechange?: (value: string) => void;
  } = $props();

  let host = $state<HTMLDivElement | null>(null);
  let view = $state<EditorView | null>(null);
  const completionCompartment = new Compartment();
  const editableCompartment = new Compartment();

  function analyze(next: string, target = view) {
    const analysis = analyzeFormulaDraft(next, sources);
    onanalysis?.(analysis);
    if (target) {
      target.dispatch(
        setDiagnostics(
          target.state,
          formulaEditorDiagnostics(analysis.diagnostics, diagnosticMessage),
        ),
      );
    }
  }

  onMount(() => {
    if (!browser || !host) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        placeholderExtension(placeholder),
        editableCompartment.of([
          EditorState.readOnly.of(disabled),
          EditorView.editable.of(!disabled),
        ]),
        completionCompartment.of(autocompletion({ override: [formulaCompletionSource(sources)] })),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          value = update.state.doc.toString();
          onvaluechange?.(value);
          analyze(value, update.view);
        }),
        EditorView.theme({
          '&': {
            color: 'var(--color-text-primary)',
            backgroundColor: 'var(--color-surface-1)',
            fontSize: 'var(--font-size-label)',
          },
          '.cm-content': {
            caretColor: 'var(--color-accent)',
            fontFamily: 'var(--font-family-mono)',
          },
          '.cm-scroller': { overflow: 'auto' },
          '&.cm-focused': { boxShadow: 'var(--shadow-focus)', outline: 'none' },
          '.cm-tooltip': {
            color: 'var(--color-text-primary)',
            backgroundColor: 'var(--color-surface-2)',
            borderColor: 'var(--color-border)',
          },
          '.cm-tooltip-autocomplete ul li[aria-selected]': {
            color: 'var(--color-on-accent)',
            backgroundColor: 'var(--color-accent)',
          },
        }),
      ],
    });
    view = new EditorView({ state, parent: host });
    analyze(value, view);
  });

  onDestroy(() => view?.destroy());

  $effect(() => {
    const next = value;
    if (!view || view.state.doc.toString() === next) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
    analyze(next);
  });

  $effect(() => {
    if (!view) return;
    view.dispatch({
      effects: [
        completionCompartment.reconfigure(
          autocompletion({ override: [formulaCompletionSource(sources)] }),
        ),
        editableCompartment.reconfigure([
          EditorState.readOnly.of(disabled),
          EditorView.editable.of(!disabled),
        ]),
      ],
    });
    analyze(view.state.doc.toString());
  });
</script>

<div class="formula-editor" class:disabled bind:this={host}></div>

<style>
  .formula-editor {
    min-height: calc(var(--space-12) * 2);
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
  }
  .formula-editor :global(.cm-editor) {
    min-height: inherit;
  }
  .formula-editor :global(.cm-content) {
    padding: var(--space-3);
  }
</style>
