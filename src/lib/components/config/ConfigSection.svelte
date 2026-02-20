<script lang="ts">
  import type { ConfigGroup } from '$lib/types/config';
  import { configState, dirtyPaths } from '$lib/state/config.svelte';
  import ConfigField from './ConfigField.svelte';

  let { group, expanded = false, ontoggle, configuredCount = 0 }: {
    group: ConfigGroup;
    expanded?: boolean;
    ontoggle?: () => void;
    configuredCount?: number;
  } = $props();

  let showAdvanced = $state(false);

  const basicFields = $derived(group.fields.filter((f) => !f.hint.advanced));
  const advancedFields = $derived(group.fields.filter((f) => f.hint.advanced));
  const hasDirty = $derived(group.fields.some((f) => dirtyPaths.value.has(f.key)));
</script>

<section id="config-group-{group.id}" class="scroll-mt-4">
  <!-- Clickable card header -->
  <button
    type="button"
    class="w-full flex items-center gap-2.5 px-4 py-3 bg-card border border-border cursor-pointer transition-colors hover:bg-bg3
      {expanded ? 'rounded-t-lg border-b-0' : 'rounded-lg'}"
    onclick={() => ontoggle?.()}
  >
    <!-- Chevron -->
    <span class="text-muted-foreground text-[10px] transition-transform {expanded ? 'rotate-90' : ''}"
      >&#9654;</span>

    <!-- Label -->
    <span class="text-xs font-semibold text-foreground uppercase tracking-wider">{group.label}</span>

    <!-- Field count -->
    <span class="text-[10px] text-muted-foreground">{group.fields.length} field{group.fields.length === 1 ? '' : 's'}</span>

    <!-- Configured count -->
    {#if configuredCount > 0}
      <span class="text-[10px] text-accent">{configuredCount} configured</span>
    {/if}

    <!-- Spacer -->
    <span class="flex-1"></span>

    <!-- Dirty indicator -->
    {#if hasDirty}
      <span class="w-1.5 h-1.5 rounded-full bg-accent shrink-0"></span>
    {/if}
  </button>

  <!-- Expandable body -->
  {#if expanded}
    <div class="bg-card border border-border border-t-0 rounded-b-lg p-4 space-y-4">
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
  {/if}
</section>
