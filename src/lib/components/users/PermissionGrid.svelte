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
    if (next.has(perm)) next.delete(perm); else next.add(perm);
    onChange?.([...next]);
  }
</script>

<div class="space-y-1 text-xs">
  {#each Object.entries(catalog) as [resource, actions] (resource)}
    <div class="grid grid-cols-[100px_1fr] gap-2 items-center">
      <span class="text-muted">{resource}</span>
      <div class="flex flex-wrap gap-2">
        {#each actions as action (action)}
          {@const perm = `${resource}:${action}`}
          <label class="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" disabled={readonly} checked={selected.has(perm)} onchange={() => toggle(perm)} />
            <span>{action}</span>
          </label>
        {/each}
      </div>
    </div>
  {/each}
</div>
