<script lang="ts">
  import type { FormulaAnalysis, FormulaVariableDraft } from '$lib/tables/formula';
  import FormulaVariablesEditor from './FormulaVariablesEditor.svelte';

  let { disabled = false }: { disabled?: boolean } = $props();
  let variables = $state<FormulaVariableDraft[]>([
    { id: '10000000-0000-4000-8000-000000000001', name: null, expression: '1' },
  ]);
  let primaryVariableId = $state('10000000-0000-4000-8000-000000000001');
  let announcement = $state('');
  const sources = [];

  const analysis: FormulaAnalysis = {
    ast: { kind: 'literal', value: 1, valueType: 'number', from: 0, to: 1 },
    outputType: {
      kind: 'number',
      dimension: 'unitless',
      currency: null,
      basis: null,
      nullable: false,
    },
    dependencies: [],
    diagnostics: [],
  };
</script>

<FormulaVariablesEditor
  {variables}
  {primaryVariableId}
  {sources}
  {disabled}
  diagnosticMessage={(diagnostic) => diagnostic.code}
  onchange={(next, primary) => {
    variables = next;
    primaryVariableId = primary;
  }}
  onanalysis={() => analysis}
  onannounce={(message) => (announcement = message)}
/>
<output aria-label="variable order">{variables.map(({ id }) => id).join(',')}</output>
<output aria-label="variable names">{JSON.stringify(variables.map(({ name }) => name))}</output>
<output aria-label="primary variable">{primaryVariableId}</output>
<output aria-label="announcement">{announcement}</output>
