<script lang="ts">
  const { data } = $props();
</script>

<div class="p-6">
  <h1 class="text-lg font-semibold mb-4">All organizations</h1>
  <ul class="space-y-2">
    {#each data.orgs as o (o.id)}
      <li class="flex items-center justify-between border border-border rounded px-3 py-2">
        <div>
          <div class="text-sm text-foreground">{o.name}</div>
          <div class="text-xs text-muted font-mono">{o.slug} · {o.members} members</div>
        </div>
      </li>
    {/each}
  </ul>
</div>
