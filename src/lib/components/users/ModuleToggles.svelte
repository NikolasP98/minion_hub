<script lang="ts">
  import type { ModuleKey } from '$lib/permissions';

  type Modules = Record<ModuleKey, { label: string; description: string; resources: string[] }>;

  let {
    modules,
    selected,
    readonly = false,
    onToggle,
  }: {
    modules: Modules;
    selected: Set<string>;
    readonly?: boolean;
    onToggle?: (perm: string, next: boolean) => void;
  } = $props();

  const entries = $derived(
    (Object.entries(modules) as [ModuleKey, Modules[ModuleKey]][]).map(([key, mod]) => ({
      key,
      perm: `module:${key}`,
      label: mod.label,
      description: mod.description,
      resources: mod.resources,
    })),
  );
</script>

<div class="space-y-2">
  {#each entries as m (m.key)}
    {@const on = selected.has(m.perm)}
    <button
      type="button"
      disabled={readonly}
      class="w-full text-left flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors {on
        ? 'bg-accent/10 border-accent/40'
        : 'bg-bg2/40 border-border hover:border-border/80'} {readonly ? 'opacity-60 cursor-not-allowed' : ''}"
      onclick={() => onToggle?.(m.perm, !on)}
    >
      <span
        class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border {on
          ? 'bg-accent border-accent text-white'
          : 'border-border bg-bg2'}"
        aria-hidden="true"
      >
        {#if on}
          <svg viewBox="0 0 12 12" class="h-3 w-3"><path d="M2 6.2 4.6 9 10 3.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
        {/if}
      </span>
      <span class="min-w-0 flex-1">
        <span class="flex items-baseline justify-between gap-2">
          <span class="font-medium text-foreground text-[13px]">{m.label}</span>
          <span class="text-[10px] text-muted">{m.resources.length} pages</span>
        </span>
        <span class="block text-[11px] text-muted leading-snug mt-0.5">{m.description}</span>
        <span class="block text-[10px] text-muted/80 mt-1 font-mono truncate">{m.resources.join(' · ')}</span>
      </span>
    </button>
  {/each}
</div>
