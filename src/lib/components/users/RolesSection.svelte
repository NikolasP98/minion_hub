<script lang="ts">
  import { onMount } from 'svelte';
  import PermissionGrid from './PermissionGrid.svelte';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';

  type Role = {
    id: string;
    name: string;
    description: string | null;
    isSystem: boolean;
    permissions: string[];
    memberCount: number;
  };

  let roles = $state<Role[]>([]);
  let catalog = $state<Record<string, string[]>>({});
  let expandedId = $state<string | null>(null);
  let creating = $state(false);
  let draftName = $state('');
  let draftDesc = $state('');
  let draftPerms = $state<string[]>([]);

  async function load() {
    const [rRes, cRes] = await Promise.all([
      fetch('/api/roles'),
      fetch('/api/roles/permissions-catalog'),
    ]);
    if (rRes.ok) roles = ((await rRes.json()) as { roles: Role[] }).roles;
    if (cRes.ok) catalog = ((await cRes.json()) as { catalog: Record<string, string[]> }).catalog;
  }

  async function saveRole(role: Role, perms: string[]) {
    const res = await fetch(`/api/roles/${role.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: perms }),
    });
    if (res.ok) {
      roles = roles.map((r) => (r.id === role.id ? { ...r, permissions: perms } : r));
      toastSuccess('Role updated');
    } else {
      toastError('Save failed');
    }
  }

  async function createDraft() {
    if (!draftName) return;
    const res = await fetch('/api/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: draftName, description: draftDesc, permissions: draftPerms }),
    });
    if (res.ok) {
      draftName = '';
      draftDesc = '';
      draftPerms = [];
      creating = false;
      await load();
    } else {
      const d = await res.json().catch(() => ({}));
      toastError((d as { message?: string }).message ?? 'create failed');
    }
  }

  async function removeRole(role: Role) {
    if (role.isSystem) return;
    if (!confirm(`Delete role "${role.name}"?`)) return;
    const res = await fetch(`/api/roles/${role.id}`, { method: 'DELETE' });
    if (res.ok) roles = roles.filter((r) => r.id !== role.id);
    else toastError('Delete failed');
  }

  onMount(load);
</script>

<section class="max-w-3xl mx-auto mt-8">
  <div class="flex items-center justify-between mb-3">
    <h2 class="text-sm font-semibold text-foreground uppercase tracking-wider">Roles</h2>
    <button
      class="text-xs px-3 py-1.5 rounded-md bg-accent text-white font-semibold"
      onclick={() => (creating = !creating)}
    >
      {creating ? 'Cancel' : '+ New Role'}
    </button>
  </div>

  {#if creating}
    <div class="bg-card border border-border rounded-lg p-4 mb-3 space-y-2">
      <input class="bg-bg2 border border-border rounded px-2 py-1.5 text-xs w-full" placeholder="Role name" bind:value={draftName} />
      <input class="bg-bg2 border border-border rounded px-2 py-1.5 text-xs w-full" placeholder="Description" bind:value={draftDesc} />
      <PermissionGrid {catalog} selected={new Set(draftPerms)} onChange={(p) => (draftPerms = p)} />
      <button class="text-xs px-3 py-1.5 rounded bg-accent text-white" onclick={createDraft}>Create</button>
    </div>
  {/if}

  <div class="bg-card border border-border rounded-lg overflow-hidden">
    {#each roles as r (r.id)}
      <div class="border-b border-border/50 last:border-0">
        <div class="px-4 py-3 cursor-pointer hover:bg-muted/30" onclick={() => (expandedId = expandedId === r.id ? null : r.id)}>
          <div class="flex items-center gap-2">
            <span class="font-semibold text-foreground">{r.name}</span>
            {#if r.isSystem}
              <span class="text-[10px] px-1.5 py-0.5 rounded bg-muted/30 text-muted">Built-in</span>
            {/if}
            <span class="text-muted text-[10px] ml-auto">{r.memberCount} members</span>
            {#if !r.isSystem}
              <button class="text-muted hover:text-destructive bg-transparent border-none cursor-pointer" onclick={(e) => { e.stopPropagation(); removeRole(r); }}>✕</button>
            {/if}
          </div>
          {#if r.description}
            <div class="text-muted text-[11px] mt-1">{r.description}</div>
          {/if}
        </div>
        {#if expandedId === r.id}
          <div class="px-4 py-3 bg-bg2/30">
            <PermissionGrid
              {catalog}
              selected={new Set(r.permissions)}
              readonly={r.isSystem}
              onChange={(p) => saveRole(r, p)}
            />
          </div>
        {/if}
      </div>
    {/each}
  </div>
</section>
