<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import ScanLine from '$lib/components/decorations/ScanLine.svelte';
  const { data } = $props();

  let name = $state('');
  let url = $state('');
  let token = $state('');
  let adding = $state(false);
  let addError = $state<string | null>(null);
  let addSuccess = $state<string | null>(null);

  async function addGateway() {
    if (adding) return;
    adding = true; addError = null; addSuccess = null;
    const res = await fetch('/api/gateways', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), url: url.trim(), token: token.trim() }),
    });
    adding = false;
    if (res.ok) {
      name = ''; url = ''; token = '';
      addSuccess = 'Gateway added.';
      await invalidateAll();
    } else {
      const j = await res.json().catch(() => ({})) as { error?: string };
      addError = j.error ?? 'Could not add gateway.';
    }
  }

  async function removeGateway(id: string) {
    await fetch(`/api/gateways/${id}`, { method: 'DELETE' });
    await invalidateAll();
  }
</script>

<div class="p-6 space-y-8">
  <section>
    <h1 class="text-lg font-semibold mb-4">Gateways</h1>

    <div class="border border-border rounded-lg overflow-hidden mb-6">
      <div class="relative px-4 py-3 border-b border-border bg-bg/60">
        <ScanLine speed={10} opacity={0.02} />
        <span class="text-[10px] font-mono text-muted uppercase tracking-widest">Add gateway</span>
      </div>
      <div class="p-4 space-y-3">
        <input bind:value={name} placeholder="Name (e.g. production)"
          class="w-full bg-bg border border-border rounded px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted/40 focus:outline-none focus:border-accent/60" />
        <input bind:value={url} placeholder="URL (ws:// or wss://)"
          class="w-full bg-bg border border-border rounded px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted/40 focus:outline-none focus:border-accent/60" />
        <input bind:value={token} type="password" placeholder="Token"
          class="w-full bg-bg border border-border rounded px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted/40 focus:outline-none focus:border-accent/60" />
        {#if addError}<p class="text-[11px] font-mono text-red-400">{addError}</p>{/if}
        {#if addSuccess}<p class="text-[11px] font-mono text-green-400">{addSuccess}</p>{/if}
        <button onclick={addGateway} disabled={adding || !name || !url || !token}
          class="px-4 py-2 rounded border text-sm font-mono bg-accent/20 border-accent/30 text-accent hover:bg-accent/30 disabled:opacity-50">
          {adding ? 'Adding…' : 'Add gateway'}
        </button>
      </div>
    </div>

    {#if data.gateways.length === 0}
      <p class="text-sm text-muted">No gateways configured yet.</p>
    {:else}
      <ul class="space-y-2">
        {#each data.gateways as g (g.id)}
          <li class="flex items-center justify-between border border-border rounded px-3 py-2">
            <div>
              <div class="text-sm text-foreground">{g.name}</div>
              <div class="text-xs text-muted font-mono">{g.url}</div>
            </div>
            <button onclick={() => removeGateway(g.id)}
              class="text-xs text-red-400 hover:text-red-300 px-2 py-1">Remove</button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>
