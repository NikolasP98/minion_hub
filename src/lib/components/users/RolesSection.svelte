<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidate } from '$app/navigation';
  import { Plus, Trash2, ShieldCheck, Users, Pencil, Check, X } from 'lucide-svelte';
  import PermissionGrid from './PermissionGrid.svelte';
  import ModuleToggles from './ModuleToggles.svelte';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
  import { MODULES as DEFAULT_MODULES, type ModuleKey } from '$lib/permissions';

  type Role = {
    id: string;
    name: string;
    description: string | null;
    isSystem: boolean;
    permissions: string[];
    memberCount: number;
  };

  type Modules = Record<ModuleKey, { label: string; description: string; resources: string[] }>;

  interface Props {
    initialRoles?: Role[];
    initialCatalog?: Record<string, string[]>;
    modules?: Modules;
  }
  let {
    initialRoles = [],
    initialCatalog = {},
    modules = DEFAULT_MODULES,
  }: Props = $props();

  const hasServerData = $derived(
    initialRoles.length > 0 || Object.keys(initialCatalog).length > 0,
  );

  // svelte-ignore state_referenced_locally
  let roles = $state<Role[]>(initialRoles);
  // svelte-ignore state_referenced_locally
  let catalog = $state<Record<string, string[]>>(initialCatalog);
  // svelte-ignore state_referenced_locally
  let selectedId = $state<string | null>(initialRoles[0]?.id ?? null);
  let creating = $state(false);
  let draftName = $state('');
  let draftDesc = $state('');
  let draftPerms = $state<string[]>([]);
  let editingMeta = $state(false);
  let metaName = $state('');
  let metaDesc = $state('');

  const selected = $derived(roles.find((r) => r.id === selectedId) ?? null);

  async function load() {
    const [rRes, cRes] = await Promise.all([
      fetch('/api/roles'),
      fetch('/api/roles/permissions-catalog'),
    ]);
    if (rRes.ok) roles = ((await rRes.json()) as { roles: Role[] }).roles;
    if (cRes.ok) catalog = ((await cRes.json()) as { catalog: Record<string, string[]> }).catalog;
    if (!selectedId && roles[0]) selectedId = roles[0].id;
  }

  function selectRole(id: string) {
    selectedId = id;
    creating = false;
    editingMeta = false;
  }

  async function persistPerms(role: Role, perms: string[]) {
    const prev = role.permissions;
    roles = roles.map((r) => (r.id === role.id ? { ...r, permissions: perms } : r));
    const res = await fetch(`/api/roles/${role.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: perms }),
    });
    if (res.ok) {
      void invalidate('settings:roles');
    } else {
      roles = roles.map((r) => (r.id === role.id ? { ...r, permissions: prev } : r));
      toastError('Save failed');
    }
  }

  function togglePermission(perm: string, next: boolean) {
    if (!selected || selected.isSystem) return;
    const set = new Set(selected.permissions);
    if (next) set.add(perm);
    else set.delete(perm);
    void persistPerms(selected, [...set]);
  }

  function onGridChange(perms: string[]) {
    if (!selected || selected.isSystem) return;
    void persistPerms(selected, perms);
  }

  function startCreate() {
    creating = true;
    draftName = '';
    draftDesc = '';
    draftPerms = [];
  }

  async function createDraft() {
    if (!draftName.trim()) return;
    const res = await fetch('/api/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: draftName.trim(),
        description: draftDesc.trim() || null,
        permissions: draftPerms,
      }),
    });
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { id?: string };
      creating = false;
      await load();
      void invalidate('settings:roles');
      toastSuccess('Role created');
      if (body.id) selectedId = body.id;
    } else {
      const d = await res.json().catch(() => ({}));
      toastError((d as { message?: string }).message ?? 'create failed');
    }
  }

  async function removeRole(role: Role) {
    if (role.isSystem) return;
    if (!confirm(`Delete role "${role.name}"?`)) return;
    const res = await fetch(`/api/roles/${role.id}`, { method: 'DELETE' });
    if (res.ok) {
      roles = roles.filter((r) => r.id !== role.id);
      if (selectedId === role.id) selectedId = roles[0]?.id ?? null;
      void invalidate('settings:roles');
      toastSuccess('Role deleted');
    } else {
      toastError('Delete failed');
    }
  }

  function startEditMeta() {
    if (!selected || selected.isSystem) return;
    metaName = selected.name;
    metaDesc = selected.description ?? '';
    editingMeta = true;
  }

  async function saveMeta() {
    if (!selected) return;
    const res = await fetch(`/api/roles/${selected.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: metaName.trim(), description: metaDesc.trim() || null }),
    });
    if (res.ok) {
      roles = roles.map((r) =>
        r.id === selected!.id
          ? { ...r, name: metaName.trim(), description: metaDesc.trim() || null }
          : r,
      );
      editingMeta = false;
      void invalidate('settings:roles');
    } else {
      toastError('Save failed');
    }
  }

  onMount(() => {
    if (!hasServerData) void load();
  });

  // toggle a draft perm
  function toggleDraftPerm(perm: string, next: boolean) {
    const set = new Set(draftPerms);
    if (next) set.add(perm);
    else set.delete(perm);
    draftPerms = [...set];
  }
</script>

<section class="max-w-6xl mx-auto pt-6 px-4 flex-1 min-h-0 overflow-y-auto">
  <header class="flex items-baseline justify-between mb-5">
    <div>
      <h2 class="text-base font-semibold text-foreground">Roles</h2>
      <p class="text-[12px] text-muted mt-0.5">
        Group permissions and pages members can see. Built-in roles are read-only.
      </p>
    </div>
  </header>

  <div class="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4 items-start">
    <!-- Sidebar -->
    <aside class="bg-card border border-border rounded-lg overflow-hidden">
      <div class="flex items-center justify-between px-3 py-2.5 border-b border-border/60">
        <span class="text-[11px] uppercase tracking-wider text-muted font-semibold">All roles</span>
        <button
          class="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-accent text-white hover:bg-accent/90 font-medium"
          onclick={startCreate}
        >
          <Plus class="h-3 w-3" /> New
        </button>
      </div>
      <ul class="divide-y divide-border/40">
        {#each roles as r (r.id)}
          {@const active = r.id === selectedId && !creating}
          <li>
            <button
              type="button"
              class="w-full text-left px-3 py-2.5 flex items-center gap-2 transition-colors {active
                ? 'bg-accent/10'
                : 'hover:bg-muted/20'}"
              onclick={() => selectRole(r.id)}
            >
              <span class="h-1.5 w-1.5 rounded-full {active ? 'bg-accent' : 'bg-muted/50'}"></span>
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-1.5">
                  <span class="text-[13px] font-medium text-foreground truncate">{r.name}</span>
                  {#if r.isSystem}
                    <ShieldCheck class="h-3 w-3 text-muted" />
                  {/if}
                </span>
                {#if r.description}
                  <span class="block text-[11px] text-muted truncate">{r.description}</span>
                {/if}
              </span>
              <span class="inline-flex items-center gap-1 text-[10px] text-muted">
                <Users class="h-3 w-3" />
                {r.memberCount}
              </span>
            </button>
          </li>
        {/each}
        {#if roles.length === 0}
          <li class="px-3 py-6 text-center text-[12px] text-muted">No roles yet</li>
        {/if}
      </ul>
    </aside>

    <!-- Detail / Create -->
    <div class="bg-card border border-border rounded-lg">
      {#if creating}
        <div class="p-5 space-y-5">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-semibold text-foreground">New role</h3>
            <button
              class="text-muted hover:text-foreground p-1 rounded"
              aria-label="Cancel"
              onclick={() => (creating = false)}
            >
              <X class="h-4 w-4" />
            </button>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="block">
              <span class="block text-[11px] uppercase tracking-wider text-muted font-semibold mb-1">Name</span>
              <input
                class="bg-bg2 border border-border rounded-md px-2.5 py-1.5 text-[13px] w-full focus:outline-none focus:border-accent"
                placeholder="e.g. Support"
                bind:value={draftName}
              />
            </label>
            <label class="block">
              <span class="block text-[11px] uppercase tracking-wider text-muted font-semibold mb-1">Description</span>
              <input
                class="bg-bg2 border border-border rounded-md px-2.5 py-1.5 text-[13px] w-full focus:outline-none focus:border-accent"
                placeholder="What this role is for"
                bind:value={draftDesc}
              />
            </label>
          </div>
          <div>
            <h4 class="text-[11px] uppercase tracking-wider text-muted font-semibold mb-2">Modules</h4>
            <ModuleToggles
              {modules}
              selected={new Set(draftPerms)}
              onToggle={toggleDraftPerm}
            />
          </div>
          <div>
            <h4 class="text-[11px] uppercase tracking-wider text-muted font-semibold mb-2">Permissions</h4>
            <div class="bg-bg2/40 border border-border rounded-md p-3">
              <PermissionGrid {catalog} selected={new Set(draftPerms)} onChange={(p) => (draftPerms = p)} />
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button
              class="inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md bg-accent text-white font-medium hover:bg-accent/90 disabled:opacity-50"
              disabled={!draftName.trim()}
              onclick={createDraft}
            >
              <Check class="h-3.5 w-3.5" /> Create role
            </button>
            <button
              class="text-[12px] px-3 py-1.5 rounded-md border border-border text-muted hover:text-foreground"
              onclick={() => (creating = false)}
            >
              Cancel
            </button>
          </div>
        </div>
      {:else if selected}
        <div class="p-5 space-y-5">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              {#if editingMeta}
                <div class="space-y-2">
                  <input
                    class="bg-bg2 border border-border rounded-md px-2.5 py-1.5 text-[15px] font-semibold w-full"
                    bind:value={metaName}
                  />
                  <input
                    class="bg-bg2 border border-border rounded-md px-2.5 py-1.5 text-[12px] w-full"
                    placeholder="Description"
                    bind:value={metaDesc}
                  />
                  <div class="flex gap-2">
                    <button class="text-[11px] px-2.5 py-1 rounded bg-accent text-white" onclick={saveMeta}>Save</button>
                    <button class="text-[11px] px-2.5 py-1 rounded border border-border text-muted" onclick={() => (editingMeta = false)}>Cancel</button>
                  </div>
                </div>
              {:else}
                <div class="flex items-center gap-2 flex-wrap">
                  <h3 class="text-[15px] font-semibold text-foreground">{selected.name}</h3>
                  {#if selected.isSystem}
                    <span class="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-muted/20 text-muted">
                      <ShieldCheck class="h-3 w-3" /> Built-in
                    </span>
                  {/if}
                  <span class="inline-flex items-center gap-1 text-[11px] text-muted ml-auto">
                    <Users class="h-3 w-3" /> {selected.memberCount} member{selected.memberCount === 1 ? '' : 's'}
                  </span>
                </div>
                {#if selected.description}
                  <p class="text-[12px] text-muted mt-1">{selected.description}</p>
                {/if}
              {/if}
            </div>
            {#if !selected.isSystem && !editingMeta}
              <div class="flex items-center gap-1">
                <button
                  class="p-1.5 rounded text-muted hover:text-foreground hover:bg-muted/20"
                  aria-label="Edit role"
                  onclick={startEditMeta}
                >
                  <Pencil class="h-3.5 w-3.5" />
                </button>
                <button
                  class="p-1.5 rounded text-muted hover:text-destructive hover:bg-destructive/10"
                  aria-label="Delete role"
                  onclick={() => removeRole(selected!)}
                >
                  <Trash2 class="h-3.5 w-3.5" />
                </button>
              </div>
            {/if}
          </div>

          <section>
            <div class="flex items-baseline justify-between mb-2">
              <h4 class="text-[11px] uppercase tracking-wider text-muted font-semibold">Modules</h4>
              <span class="text-[10px] text-muted">Which sections this role can see</span>
            </div>
            <ModuleToggles
              {modules}
              selected={new Set(selected.permissions)}
              readonly={selected.isSystem}
              onToggle={togglePermission}
            />
          </section>

          <section>
            <div class="flex items-baseline justify-between mb-2">
              <h4 class="text-[11px] uppercase tracking-wider text-muted font-semibold">Permissions</h4>
              <span class="text-[10px] text-muted">Per-action capabilities within visible modules</span>
            </div>
            <div class="bg-bg2/40 border border-border rounded-md p-3">
              <PermissionGrid
                {catalog}
                selected={new Set(selected.permissions)}
                readonly={selected.isSystem}
                onChange={onGridChange}
              />
            </div>
          </section>
        </div>
      {:else}
        <div class="p-10 text-center text-[12px] text-muted">
          Select a role to edit, or create a new one.
        </div>
      {/if}
    </div>
  </div>
</section>
