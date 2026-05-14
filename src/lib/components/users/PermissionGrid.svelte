<script lang="ts">
  let {
    catalog,
    selected,
    readonly = false,
    onChange,
  }: {
    catalog: Record<string, string[]>;
    selected: Set<string>;
    readonly?: boolean;
    onChange?: (perms: string[]) => void;
  } = $props();

  function toggle(perm: string) {
    if (readonly) return;
    const next = new Set(selected);
    if (next.has(perm)) next.delete(perm);
    else next.add(perm);
    onChange?.([...next]);
  }

  function toggleAll(resource: string, actions: string[], allOn: boolean) {
    if (readonly) return;
    const next = new Set(selected);
    for (const a of actions) {
      const p = `${resource}:${a}`;
      if (allOn) next.delete(p);
      else next.add(p);
    }
    onChange?.([...next]);
  }
</script>

<div class="space-y-1.5 text-[12px]">
  {#each Object.entries(catalog) as [resource, actions] (resource)}
    {@const allOn = actions.every((a) => selected.has(`${resource}:${a}`))}
    <div class="grid grid-cols-[110px_1fr] gap-3 items-center py-1 border-b border-border/30 last:border-0">
      <button
        type="button"
        class="text-left text-muted hover:text-foreground text-[12px] font-medium capitalize disabled:cursor-not-allowed"
        disabled={readonly}
        title={readonly ? '' : allOn ? `Clear all ${resource} permissions` : `Grant all ${resource} permissions`}
        onclick={() => toggleAll(resource, actions, allOn)}
      >
        {resource}
      </button>
      <div class="flex flex-wrap gap-x-3 gap-y-1">
        {#each actions as action (action)}
          {@const perm = `${resource}:${action}`}
          {@const on = selected.has(perm)}
          <label
            class="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 cursor-pointer select-none {on
              ? 'text-foreground'
              : 'text-muted'} {readonly ? 'cursor-not-allowed' : 'hover:bg-muted/20'}"
          >
            <input
              type="checkbox"
              class="accent-accent"
              disabled={readonly}
              checked={on}
              onchange={() => toggle(perm)}
            />
            <span>{action}</span>
          </label>
        {/each}
      </div>
    </div>
  {/each}
</div>
