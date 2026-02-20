<script lang="ts">
  import type { ConfigGroup } from '$lib/types/config';
  import { configState, dirtyPaths } from '$lib/state/config.svelte';
  import ConfigField from './ConfigField.svelte';

  let { group }: { group: ConfigGroup } = $props();

  let showAdvanced = $state(false);

  const basicFields = $derived(group.fields.filter((f) => !f.hint.advanced));
  const advancedFields = $derived(group.fields.filter((f) => f.hint.advanced));
  const hasDirty = $derived(group.fields.some((f) => dirtyPaths.value.has(f.key)));
</script>

<section id="config-group-{group.id}" class="scroll-mt-4">
  <div class="flex items-center gap-2 mb-4">
    <h2 class="text-sm font-semibold text-foreground uppercase tracking-wider">{group.label}</h2>
    {#if hasDirty}
      <span class="w-1.5 h-1.5 rounded-full bg-accent"></span>
    {/if}
    <span class="text-[10px] text-muted-foreground ml-1">{group.fields.length} field{group.fields.length === 1 ? '' : 's'}</span>
  </div>

  <div class="bg-card border border-border rounded-lg p-4 space-y-4">
    {#each basicFields as field (field.path)}
      <ConfigField
        path={field.path}
        schema={field.schema}
        hint={field.hint}
        value={configState.current[field.key]}
      />
    {/each}

    {#if advancedFields.length > 0}
      <button
        type="button"
        class="bg-transparent border-none text-[11px] text-muted-foreground cursor-pointer p-0 transition-colors hover:text-foreground"
        onclick={() => showAdvanced = !showAdvanced}
      >
        {showAdvanced ? 'Hide' : 'Show'} {advancedFields.length} advanced field{advancedFields.length === 1 ? '' : 's'}
      </button>

      {#if showAdvanced}
        <div class="border-t border-border pt-4 space-y-4">
          {#each advancedFields as field (field.path)}
            <ConfigField
              path={field.path}
              schema={field.schema}
              hint={field.hint}
              value={configState.current[field.key]}
            />
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</section>
