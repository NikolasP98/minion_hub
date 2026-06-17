<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { invalidate } from '$app/navigation';
  import OverviewGraph from '$lib/components/overview/OverviewGraph.svelte';
  import EntityChip from '$lib/components/ui/EntityChip.svelte';
  import { visibleAgents } from '$lib/state/gateway/gateway-data.svelte';
  import { areaRef, AREA_COLORS, AREA_ICON_KEYS, iconByName } from '$lib/types/entities';
  import { page } from '$app/state';
  import type { OrgArea } from '$server/services/org-areas.service';

  let { data } = $props();

  const org = $derived.by(() => {
    const orgs = (page.data.organizations ?? []) as Array<{ id: string; name: string }>;
    const active = page.data.activeOrgId as string | null;
    return orgs.find((o) => o.id === active) ?? orgs[0] ?? { id: 'org', name: 'Organization' };
  });

  const agents = $derived(visibleAgents.value.map((a) => ({ id: a.id, name: a.name })));
  const members = $derived(data.members);

  let editing = $state(false);
  let busy = $state(false);
  let newName = $state('');
  let newColor = $state(AREA_COLORS[0]);
  let newIcon = $state(AREA_ICON_KEYS[0]);

  async function api(path: string, method: string, body?: unknown) {
    busy = true;
    try {
      const res = await fetch(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(await res.text());
      await invalidate('app:org-areas');
    } finally {
      busy = false;
    }
  }

  async function seed() {
    await api('/api/org-areas', 'POST', { seed: true });
  }
  async function createArea() {
    if (!newName.trim()) return;
    await api('/api/org-areas', 'POST', { name: newName.trim(), color: newColor, icon: newIcon });
    newName = '';
  }
  async function removeArea(id: string) {
    await api(`/api/org-areas/${id}`, 'DELETE');
  }
  async function toggleAgent(area: OrgArea, agentId: string) {
    const next = area.agentIds.includes(agentId)
      ? area.agentIds.filter((x) => x !== agentId)
      : [...area.agentIds, agentId];
    await api(`/api/org-areas/${area.id}`, 'PATCH', { agentIds: next });
  }
  async function toggleUser(area: OrgArea, userId: string) {
    const next = area.userIds.includes(userId)
      ? area.userIds.filter((x) => x !== userId)
      : [...area.userIds, userId];
    await api(`/api/org-areas/${area.id}`, 'PATCH', { userIds: next });
  }
</script>

<div class="flex h-full min-h-0 overflow-hidden relative">
  <!-- Graph fills full height -->
  <div class="flex-1 min-w-0 relative">
    <OverviewGraph {org} areas={data.areas} {agents} {members} subscriptions={data.subscriptions} />

    <!-- Floating admin controls — top-right of graph stage, admin-only -->
    {#if data.isAdmin}
      <div class="absolute top-3 right-3 z-10 flex items-center gap-2 bg-bg2/80 backdrop-blur border border-border rounded px-2 py-1.5">
        {#if data.areas.length === 0}
          <button
            type="button"
            class="px-2.5 py-1 rounded text-xs bg-accent text-white cursor-pointer disabled:opacity-50"
            disabled={busy}
            onclick={seed}>{m.overview_seedDefault()}</button>
        {/if}
        <button
          type="button"
          class="px-2.5 py-1 rounded text-xs border border-border hover:border-accent text-foreground cursor-pointer transition-colors {editing ? 'bg-accent/20 border-accent text-accent' : ''}"
          onclick={() => (editing = !editing)}>{editing ? m.overview_done() : m.overview_editAreas()}</button>
      </div>
    {/if}
  </div>

  {#if editing && data.isAdmin}
    <aside class="w-[320px] shrink-0 border-l border-border bg-bg2 overflow-y-auto text-[12px] p-3 flex flex-col gap-3">
      <!-- Create -->
      <div class="rounded-lg border border-border p-2.5 flex flex-col gap-2">
        <div class="text-xs font-semibold text-foreground">{m.overview_newArea()}</div>
        <input
          class="w-full bg-bg1 border border-border rounded px-2 py-1 text-foreground"
          placeholder={m.overview_areaNamePlaceholder()}
          bind:value={newName} />
        <div class="flex flex-wrap gap-1">
          {#each AREA_COLORS as c (c)}
            <button type="button" aria-label={m.overview_selectColor()} class="w-5 h-5 rounded-full border-2 cursor-pointer {newColor === c ? 'border-foreground' : 'border-transparent'}" style="background-color: {c}" onclick={() => (newColor = c)}></button>
          {/each}
        </div>
        <div class="flex flex-wrap gap-1">
          {#each AREA_ICON_KEYS as k (k)}
            {@const Ico = iconByName(k)}
            <button type="button" aria-label={k} class="p-1 rounded border cursor-pointer {newIcon === k ? 'border-accent text-accent' : 'border-border text-muted hover:text-foreground'}" onclick={() => (newIcon = k)}>
              {#if Ico}<Ico size={14} />{/if}
            </button>
          {/each}
        </div>
        <button type="button" class="px-2 py-1 rounded text-xs bg-accent text-white cursor-pointer disabled:opacity-50" disabled={busy || !newName.trim()} onclick={createArea}>{m.overview_createArea()}</button>
      </div>

      <!-- Existing areas + assignment -->
      {#each data.areas as area (area.id)}
        <div class="rounded-lg border border-border p-2.5 flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <EntityChip ref={areaRef(area)} size="md" link={false} />
            <button type="button" class="text-muted hover:text-destructive cursor-pointer" title={m.overview_deleteArea()} onclick={() => removeArea(area.id)}>&times;</button>
          </div>
          <details>
            <summary class="cursor-pointer text-muted hover:text-foreground">{m.overview_agents()} ({area.agentIds.length})</summary>
            <div class="mt-1 flex flex-col gap-0.5 max-h-40 overflow-y-auto">
              {#each agents as a (a.id)}
                <label class="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={area.agentIds.includes(a.id)} onchange={() => toggleAgent(area, a.id)} />
                  <span class="truncate">{a.name ?? a.id}</span>
                </label>
              {/each}
            </div>
          </details>
          <details>
            <summary class="cursor-pointer text-muted hover:text-foreground">{m.overview_users()} ({area.userIds.length})</summary>
            <div class="mt-1 flex flex-col gap-0.5 max-h-40 overflow-y-auto">
              {#each members as u (u.id)}
                <label class="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={area.userIds.includes(u.id)} onchange={() => toggleUser(area, u.id)} />
                  <span class="truncate">{u.displayName ?? u.email ?? u.id}</span>
                </label>
              {/each}
            </div>
          </details>
        </div>
      {/each}
    </aside>
  {/if}
</div>
