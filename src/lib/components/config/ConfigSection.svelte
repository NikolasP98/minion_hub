<script lang="ts">
  import { Button } from '$lib/components/ui';
  import type { ConfigGroup } from '$lib/types/config';
  import { configState, dirtyPaths } from '$lib/state/config/config.svelte';
  import ConfigField from './ConfigField.svelte';
  import { ChevronRight, ChevronsDown, ChevronsUp } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';

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

  // Group description: try uiHints for the group key, then schema description of the first field's parent
  const groupDescription = $derived.by(() => {
    const hint = configState.uiHints[group.id];
    if (hint?.help) return hint.help;
    // If group has a single top-level field matching the group id, use its schema description
    const first = group.fields[0];
    if (first && first.schema.description) return first.schema.description;
    return '';
  });
</script>

<section id="group-{group.id}" data-group-id={group.id} class="scroll-mt-4">
  <!-- Clickable card header (sticky within scroll container) -->
  <Button
    variant="outline"
    type="button"
    class="!h-auto !w-full !justify-start !px-4 !py-3.5 sticky top-0 z-[var(--layer-sticky,10)]
      {expanded ? 'rounded-t-lg !border-b-0' : 'rounded-lg'}"
    onclick={() => ontoggle?.()}
    aria-expanded={expanded}
    aria-controls={`config-group-panel-${group.id}`}
  >
    <!-- Chevron -->
    <ChevronRight
      size={13}
      class="text-muted-foreground transition-transform duration-[var(--duration-fast)] shrink-0 {expanded ? 'rotate-90' : ''}"
    />

    <!-- Label + description -->
    <span class="flex flex-col items-start gap-0.5 min-w-0">
      <span class="flex items-center gap-2">
        <span class="text-xs font-semibold text-foreground uppercase tracking-wider">{group.label}</span>
        {#if configuredCount > 0}
          <span class="px-1.5 py-0.5 rounded-full bg-accent/15 text-accent text-xs font-medium leading-none">
            {configuredCount}
          </span>
        {/if}
      </span>
      {#if groupDescription}
        <span class="text-xs text-muted-foreground leading-tight truncate max-w-full">{groupDescription}</span>
      {/if}
    </span>

    <!-- Spacer -->
    <span class="flex-1"></span>

    <!-- Dirty indicator -->
    {#if hasDirty}
      <span class="w-1.5 h-1.5 rounded-full bg-accent shrink-0"></span>
    {/if}
  </Button>

  <!-- Expandable body -->
  {#if expanded}
    <div id={`config-group-panel-${group.id}`} class="bg-card border border-border border-t-0 rounded-b-lg p-4 space-y-4">
      {#each basicFields as field (field.path)}
        <ConfigField
          path={field.path}
          schema={field.schema}
          hint={field.hint}
          value={configState.current[field.key]}
        />
      {/each}

      {#if advancedFields.length > 0}
        <Button
          variant="ghost"
          size="sm"
          type="button"
          class="!px-0 text-xs"
          onclick={() => showAdvanced = !showAdvanced}
          aria-expanded={showAdvanced}
          aria-controls={`config-advanced-${group.id}`}
        >
          {#if showAdvanced}
            <ChevronsUp size={11} class="shrink-0" />
            {advancedFields.length === 1 ? m.config_hideAdvancedField({ count: advancedFields.length }) : m.config_hideAdvancedFields({ count: advancedFields.length })}
          {:else}
            <ChevronsDown size={11} class="shrink-0" />
            {advancedFields.length === 1 ? m.config_showAdvancedField({ count: advancedFields.length }) : m.config_showAdvancedFields({ count: advancedFields.length })}
          {/if}
        </Button>

        {#if showAdvanced}
          <div id={`config-advanced-${group.id}`} class="border-t border-border pt-4 space-y-4">
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
