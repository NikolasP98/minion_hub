# Users Tab Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `/users` page with two tabs — Team (hub user/role management) and Bindings (gateway config binding editor).

**Architecture:** Team tab is purely DB-backed via existing `/api/users` + new `/api/users/[id]` endpoints. Bindings tab reads/writes `configState.current.bindings` directly using the same save infrastructure as the Config page. Two new Svelte components (`TeamTab`, `BindingsTab`) kept separate and imported by the page.

**Tech Stack:** SvelteKit, Svelte 5 runes, Drizzle ORM (libsql), Tailwind CSS, Vitest for service tests.

---

### Task 1: Backend — `updateUserRole` + `removeUserFromTenant` service functions

**Files:**
- Modify: `src/server/services/user.service.ts`
- Modify: `src/server/services/user.service.test.ts`

**Step 1: Write failing tests**

Add to `src/server/services/user.service.test.ts`:

```ts
describe('updateUserRole', () => {
  it('calls db.update on userTenants', async () => {
    const { db } = createMockDb();
    await updateUserRole({ db, tenantId: 't1' }, 'u1', 'admin');
    expect(db.update).toHaveBeenCalledTimes(1);
  });
});

describe('removeUserFromTenant', () => {
  it('calls db.delete on userTenants', async () => {
    const { db } = createMockDb();
    await removeUserFromTenant({ db, tenantId: 't1' }, 'u1');
    expect(db.delete).toHaveBeenCalledTimes(1);
  });
});
```

Update the import at the top:
```ts
import { listUsers, createContactUser, updateUserRole, removeUserFromTenant } from './user.service';
```

**Step 2: Run to confirm failure**

```bash
cd /home/nikolas/Documents/CODE/AI/minion_hub
bun run vitest run src/server/services/user.service.test.ts
```
Expected: FAIL — `updateUserRole is not a function`

**Step 3: Implement the functions**

Add to the bottom of `src/server/services/user.service.ts`:

```ts
export async function updateUserRole(
  ctx: TenantContext,
  userId: string,
  role: 'owner' | 'admin' | 'member' | 'viewer',
) {
  await ctx.db
    .update(userTenants)
    .set({ role })
    .where(and(eq(userTenants.userId, userId), eq(userTenants.tenantId, ctx.tenantId)));
}

export async function removeUserFromTenant(ctx: TenantContext, userId: string) {
  await ctx.db
    .delete(userTenants)
    .where(and(eq(userTenants.userId, userId), eq(userTenants.tenantId, ctx.tenantId)));
}
```

**Step 4: Run tests**

```bash
bun run vitest run src/server/services/user.service.test.ts
```
Expected: all PASS

**Step 5: Commit**

```bash
git add src/server/services/user.service.ts src/server/services/user.service.test.ts
git commit -m "feat: add updateUserRole and removeUserFromTenant service functions"
```

---

### Task 2: Backend — `/api/users/[id]` PATCH + DELETE endpoint

**Files:**
- Create: `src/routes/api/users/[id]/+server.ts`

**Step 1: Create the file**

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import { updateUserRole, removeUserFromTenant } from '$server/services/user.service';

const VALID_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
type Role = (typeof VALID_ROLES)[number];

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401);

  const userId = params.id;
  if (!userId) throw error(400, 'missing id');

  const body = await request.json();
  if (!body.role || !VALID_ROLES.includes(body.role as Role)) {
    throw error(400, 'role must be one of: owner, admin, member, viewer');
  }

  await updateUserRole(ctx, userId, body.role as Role);
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401);

  const userId = params.id;
  if (!userId) throw error(400, 'missing id');

  await removeUserFromTenant(ctx, userId);
  return json({ ok: true });
};
```

**Step 2: Verify type-check**

```bash
bun run check
```
Expected: no errors in the new file.

**Step 3: Commit**

```bash
git add src/routes/api/users/
git commit -m "feat: add PATCH/DELETE /api/users/[id] endpoint"
```

---

### Task 3: Frontend — TeamTab component

**Files:**
- Create: `src/lib/components/users/TeamTab.svelte`

**Step 1: Create the component**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';

  type UserRow = {
    id: string;
    email: string;
    displayName: string | null;
    kind: 'operator' | 'contact';
    role: 'owner' | 'admin' | 'member' | 'viewer';
  };

  const ROLES = ['owner', 'admin', 'member', 'viewer'] as const;

  let users = $state<UserRow[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

  // Invite form state
  let showInvite = $state(false);
  let inviteEmail = $state('');
  let invitePassword = $state('');
  let inviteName = $state('');
  let inviteRole = $state<UserRow['role']>('member');
  let inviting = $state(false);
  let inviteError = $state<string | null>(null);

  async function load() {
    loading = true;
    error = null;
    try {
      const res = await fetch('/api/users');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { users: UserRow[] };
      users = data.users;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  async function changeRole(userId: string, role: UserRow['role']) {
    const res = await fetch(`/api/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    if (res.ok) {
      users = users.map((u) => (u.id === userId ? { ...u, role } : u));
    }
  }

  async function remove(userId: string) {
    if (!confirm('Remove this user from the tenant?')) return;
    const res = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
    if (res.ok) {
      users = users.filter((u) => u.id !== userId);
    }
  }

  async function invite() {
    if (!inviteEmail || !invitePassword) return;
    inviting = true;
    inviteError = null;
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail,
          password: invitePassword,
          displayName: inviteName || undefined,
          role: inviteRole,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { message?: string }).message ?? `HTTP ${res.status}`);
      }
      showInvite = false;
      inviteEmail = '';
      invitePassword = '';
      inviteName = '';
      inviteRole = 'member';
      await load();
    } catch (e) {
      inviteError = (e as Error).message;
    } finally {
      inviting = false;
    }
  }

  onMount(load);
</script>

<div class="flex-1 overflow-y-auto p-6">
  <div class="max-w-3xl mx-auto">

    <!-- Header row -->
    <div class="flex items-center justify-between mb-5">
      <h2 class="text-sm font-semibold text-foreground uppercase tracking-wider">Team</h2>
      <button
        class="text-xs px-3 py-1.5 rounded-md bg-accent text-white border-none cursor-pointer font-[inherit] font-semibold hover:opacity-90 transition-opacity"
        onclick={() => (showInvite = !showInvite)}
      >
        {showInvite ? 'Cancel' : '+ Invite'}
      </button>
    </div>

    <!-- Invite form -->
    {#if showInvite}
      <div class="bg-card border border-border rounded-lg p-4 mb-5 space-y-3">
        <p class="text-xs font-semibold text-foreground">New user</p>
        <div class="grid grid-cols-2 gap-3">
          <input
            class="bg-bg2 border border-border rounded-md text-foreground px-2.5 py-1.5 text-xs font-[inherit] outline-none focus:border-accent placeholder:text-muted"
            type="email"
            placeholder="Email *"
            bind:value={inviteEmail}
          />
          <input
            class="bg-bg2 border border-border rounded-md text-foreground px-2.5 py-1.5 text-xs font-[inherit] outline-none focus:border-accent placeholder:text-muted"
            type="password"
            placeholder="Password *"
            bind:value={invitePassword}
          />
          <input
            class="bg-bg2 border border-border rounded-md text-foreground px-2.5 py-1.5 text-xs font-[inherit] outline-none focus:border-accent placeholder:text-muted"
            type="text"
            placeholder="Display name"
            bind:value={inviteName}
          />
          <select
            class="bg-bg2 border border-border rounded-md text-foreground px-2.5 py-[7px] text-xs font-[inherit] outline-none cursor-pointer focus:border-accent"
            bind:value={inviteRole}
          >
            {#each ROLES as r (r)}
              <option value={r}>{r}</option>
            {/each}
          </select>
        </div>
        {#if inviteError}
          <p class="text-xs text-destructive">{inviteError}</p>
        {/if}
        <button
          class="text-xs px-3 py-1.5 rounded-md bg-accent text-white border-none cursor-pointer font-[inherit] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
          disabled={inviting || !inviteEmail || !invitePassword}
          onclick={invite}
        >
          {inviting ? 'Creating…' : 'Create user'}
        </button>
      </div>
    {/if}

    <!-- Error / loading -->
    {#if loading}
      <div class="text-muted text-xs py-8 text-center">Loading…</div>
    {:else if error}
      <div class="text-destructive text-xs py-4">{error}</div>
    {:else if users.length === 0}
      <div class="text-muted text-xs py-8 text-center">No users yet.</div>
    {:else}
      <!-- Table -->
      <div class="bg-card border border-border rounded-lg overflow-hidden">
        <table class="w-full text-xs border-collapse">
          <thead>
            <tr class="border-b border-border bg-bg2">
              <th class="text-left px-4 py-2.5 text-muted font-semibold uppercase tracking-wider text-[10px]">User</th>
              <th class="text-left px-4 py-2.5 text-muted font-semibold uppercase tracking-wider text-[10px]">Kind</th>
              <th class="text-left px-4 py-2.5 text-muted font-semibold uppercase tracking-wider text-[10px]">Role</th>
              <th class="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {#each users as u (u.id)}
              <tr class="border-b border-border/50 last:border-0 hover:bg-bg2/50 transition-colors">
                <td class="px-4 py-3">
                  <div class="font-semibold text-foreground">{u.displayName ?? u.email}</div>
                  {#if u.displayName}
                    <div class="text-muted text-[10px] mt-0.5">{u.email}</div>
                  {/if}
                </td>
                <td class="px-4 py-3">
                  <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full
                    {u.kind === 'operator' ? 'bg-accent/15 text-accent' : 'bg-muted/20 text-muted-foreground'}">
                    {u.kind}
                  </span>
                </td>
                <td class="px-4 py-3">
                  <select
                    class="bg-transparent border border-border rounded-md text-foreground px-2 py-1 text-[11px] font-[inherit] outline-none cursor-pointer focus:border-accent"
                    value={u.role}
                    onchange={(e) => changeRole(u.id, (e.currentTarget as HTMLSelectElement).value as UserRow['role'])}
                  >
                    {#each ROLES as r (r)}
                      <option value={r}>{r}</option>
                    {/each}
                  </select>
                </td>
                <td class="px-4 py-3 text-right">
                  <button
                    class="text-muted hover:text-destructive transition-colors bg-transparent border-none cursor-pointer text-xs font-[inherit]"
                    onclick={() => remove(u.id)}
                    title="Remove from tenant"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>
```

**Step 2: Verify type-check**

```bash
bun run check
```

**Step 3: Commit**

```bash
git add src/lib/components/users/
git commit -m "feat: add TeamTab component"
```

---

### Task 4: Frontend — BindingsTab component

**Files:**
- Create: `src/lib/components/users/BindingsTab.svelte`

**Step 1: Create the component**

```svelte
<script lang="ts">
  import { conn } from '$lib/state/connection.svelte';
  import { configState, setField, isDirty, save, discard, loadConfig } from '$lib/state/config.svelte';

  type BindingPeer = { kind: 'dm' | 'group'; id: string };
  type BindingMatch = { channel: string; peer: BindingPeer };
  type BindingEntry = { agentId: string; match: BindingMatch };

  const CHANNELS = ['whatsapp', 'telegram', 'discord'] as const;
  type Channel = (typeof CHANNELS)[number];

  const CHANNEL_ICONS: Record<Channel, string> = {
    whatsapp: '📱',
    telegram: '✈️',
    discord: '🎮',
  };

  // Derived bindings from config state
  const bindings = $derived(
    ((configState.current?.bindings ?? []) as BindingEntry[])
  );

  // Group by agentId
  const grouped = $derived.by(() => {
    const map = new Map<string, BindingEntry[]>();
    for (const b of bindings) {
      const list = map.get(b.agentId) ?? [];
      list.push(b);
      map.set(b.agentId, list);
    }
    return map;
  });

  // Add form state
  let addAgentId = $state('');
  let addChannel = $state<Channel>('whatsapp');
  let addKind = $state<'dm' | 'group'>('dm');
  let addPeerId = $state('');
  let addError = $state<string | null>(null);

  function removeBinding(index: number) {
    const next = [...bindings];
    next.splice(index, 1);
    setField('bindings', next);
  }

  function addBinding() {
    addError = null;
    if (!addAgentId.trim()) { addError = 'Agent ID is required'; return; }
    if (!addPeerId.trim()) { addError = 'Peer ID is required'; return; }
    const next: BindingEntry[] = [
      ...bindings,
      {
        agentId: addAgentId.trim(),
        match: { channel: addChannel, peer: { kind: addKind, id: addPeerId.trim() } },
      },
    ];
    setField('bindings', next);
    addAgentId = '';
    addPeerId = '';
  }

  let saving = $derived(configState.saving);
  let saveError = $derived(configState.saveError);
</script>

{#if !conn.connected}
  <div class="flex-1 flex items-center justify-center">
    <div class="text-center">
      <p class="text-muted-foreground text-sm mb-3">Not connected to a gateway</p>
      <a href="/" class="text-xs text-accent no-underline hover:underline">Go to dashboard</a>
    </div>
  </div>
{:else if configState.loading && !configState.loaded}
  <div class="flex-1 flex items-center justify-center">
    <div class="text-xs text-muted-foreground">Loading config…</div>
  </div>
{:else}
  <div class="flex-1 overflow-y-auto p-6">
    <div class="max-w-3xl mx-auto space-y-6">

      <h2 class="text-sm font-semibold text-foreground uppercase tracking-wider">Bindings</h2>
      <p class="text-xs text-muted-foreground -mt-4">Maps messaging peers to agents. Writes directly to gateway config.</p>

      <!-- Grouped binding cards -->
      {#if grouped.size === 0}
        <div class="text-muted text-xs py-8 text-center">No bindings configured.</div>
      {:else}
        {#each [...grouped.entries()] as [agentId, entries] (agentId)}
          <div class="bg-card border border-border rounded-lg overflow-hidden">
            <div class="px-4 py-2.5 bg-bg2 border-b border-border">
              <span class="text-xs font-bold text-foreground uppercase tracking-wide">{agentId}</span>
            </div>
            <div class="divide-y divide-border/50">
              {#each entries as b, i (i)}
                {@const globalIdx = bindings.indexOf(b)}
                <div class="flex items-center gap-3 px-4 py-2.5 hover:bg-bg2/50 transition-colors group">
                  <span class="text-base leading-none" title={b.match.channel}>
                    {CHANNEL_ICONS[b.match.channel as Channel] ?? '🔗'}
                  </span>
                  <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full
                    {b.match.peer.kind === 'dm' ? 'bg-accent/15 text-accent' : 'bg-muted/20 text-muted-foreground'}">
                    {b.match.peer.kind.toUpperCase()}
                  </span>
                  <span class="font-mono text-xs text-foreground flex-1 min-w-0 truncate">{b.match.peer.id}</span>
                  <span class="text-[10px] text-muted capitalize">{b.match.channel}</span>
                  <button
                    class="opacity-0 group-hover:opacity-100 transition-opacity text-muted hover:text-destructive bg-transparent border-none cursor-pointer text-xs font-[inherit]"
                    onclick={() => removeBinding(globalIdx)}
                    title="Remove binding"
                  >
                    ✕
                  </button>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      {/if}

      <!-- Add binding form -->
      <div class="bg-card border border-border rounded-lg p-4 space-y-3">
        <p class="text-xs font-semibold text-foreground">Add binding</p>
        <div class="grid grid-cols-2 gap-3">
          <input
            class="bg-bg2 border border-border rounded-md text-foreground px-2.5 py-1.5 text-xs font-[inherit] outline-none focus:border-accent placeholder:text-muted"
            type="text"
            placeholder="Agent ID *"
            bind:value={addAgentId}
          />
          <input
            class="bg-bg2 border border-border rounded-md text-foreground px-2.5 py-1.5 text-xs font-[inherit] outline-none focus:border-accent placeholder:text-muted"
            type="text"
            placeholder="Peer ID (phone / group ID) *"
            bind:value={addPeerId}
          />
          <select
            class="bg-bg2 border border-border rounded-md text-foreground px-2.5 py-[7px] text-xs font-[inherit] outline-none cursor-pointer focus:border-accent"
            bind:value={addChannel}
          >
            {#each CHANNELS as c (c)}
              <option value={c}>{c}</option>
            {/each}
          </select>
          <select
            class="bg-bg2 border border-border rounded-md text-foreground px-2.5 py-[7px] text-xs font-[inherit] outline-none cursor-pointer focus:border-accent"
            bind:value={addKind}
          >
            <option value="dm">DM</option>
            <option value="group">Group</option>
          </select>
        </div>
        {#if addError}
          <p class="text-xs text-destructive">{addError}</p>
        {/if}
        <button
          class="text-xs px-3 py-1.5 rounded-md bg-accent text-white border-none cursor-pointer font-[inherit] font-semibold hover:opacity-90 transition-opacity"
          onclick={addBinding}
        >
          Add
        </button>
      </div>

    </div>
  </div>

  <!-- Save bar (same pattern as Config page) -->
  {#if isDirty.value || saving || saveError}
    <div class="shrink-0 border-t border-border bg-bg/95 backdrop-blur-sm px-6 py-3 flex items-center gap-3">
      <span class="text-xs text-muted-foreground flex-1">
        {#if saveError}
          <span class="text-destructive">{saveError}</span>
        {:else if saving}
          Saving…
        {:else}
          Unsaved changes
        {/if}
      </span>
      <button
        class="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground bg-transparent cursor-pointer font-[inherit] hover:bg-bg3 transition-colors"
        onclick={discard}
        disabled={saving}
      >
        Discard
      </button>
      <button
        class="text-xs px-3 py-1.5 rounded-md bg-accent text-white border-none cursor-pointer font-[inherit] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
        onclick={save}
        disabled={saving}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  {/if}
{/if}
```

**Step 2: Verify type-check**

```bash
bun run check
```

**Step 3: Commit**

```bash
git add src/lib/components/users/
git commit -m "feat: add BindingsTab component"
```

---

### Task 5: Frontend — `/users` page + tab switcher

**Files:**
- Create: `src/routes/users/+page.svelte`

**Step 1: Create the page**

```svelte
<script lang="ts">
  import Topbar from '$lib/components/Topbar.svelte';
  import TeamTab from '$lib/components/users/TeamTab.svelte';
  import BindingsTab from '$lib/components/users/BindingsTab.svelte';
  import { conn } from '$lib/state/connection.svelte';
  import { configState, loadConfig } from '$lib/state/config.svelte';

  type Tab = 'team' | 'bindings';
  let activeTab = $state<Tab>('team');

  // Load gateway config when switching to bindings tab (if not already loaded)
  $effect(() => {
    if (activeTab === 'bindings' && conn.connected && !configState.loaded && !configState.loading) {
      loadConfig();
    }
  });
</script>

<div class="relative z-10 flex flex-col h-screen overflow-hidden text-foreground">
  <Topbar />

  <!-- Tab bar -->
  <div class="shrink-0 border-b border-border bg-bg/95 backdrop-blur-sm px-4.5 flex items-center gap-1">
    {#each (['team', 'bindings'] as Tab[]) as tab (tab)}
      <button
        class="text-xs px-3.5 py-2.5 border-b-2 transition-colors duration-100 bg-transparent border-0 cursor-pointer font-[inherit] capitalize
          {activeTab === tab
            ? 'border-b-accent text-foreground font-semibold'
            : 'border-b-transparent text-muted hover:text-foreground'}"
        onclick={() => (activeTab = tab)}
      >
        {tab}
      </button>
    {/each}
  </div>

  <!-- Content -->
  <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
    {#if activeTab === 'team'}
      <TeamTab />
    {:else}
      <BindingsTab />
    {/if}
  </div>
</div>
```

**Step 2: Verify type-check**

```bash
bun run check
```

**Step 3: Commit**

```bash
git add src/routes/users/
git commit -m "feat: add /users page with team/bindings tabs"
```

---

### Task 6: Navigation — add Users link to Topbar

**Files:**
- Modify: `src/lib/components/Topbar.svelte`

**Step 1: Add the `isUsers` derived and the nav link**

In the `<script>` block, add after the existing `isWorkshop` line:
```ts
const isUsers = $derived($page.url.pathname.startsWith('/users'));
```

In the template, add a "Users" link before the "Reliability" link:
```svelte
<a href="/users" class="text-xs no-underline px-3 py-1 rounded-full border transition-all duration-150 {isUsers ? 'bg-accent/10 text-accent border-accent/30' : 'text-muted border-border hover:bg-bg3 hover:text-foreground'}">Users</a>
```

**Step 2: Verify type-check + dev spot-check**

```bash
bun run check
```

Then run `bun run dev` and navigate to `/users` to verify both tabs render.

**Step 3: Commit**

```bash
git add src/lib/components/Topbar.svelte
git commit -m "feat: add Users nav link to Topbar"
```

---

### Task 7: Final — run all tests, verify, clean up

**Step 1: Run full test suite**

```bash
bun run test
```
Expected: all existing tests pass, new service tests pass.

**Step 2: Run type-check**

```bash
bun run check
```
Expected: no errors.

**Step 3: Commit (if any loose ends)**

```bash
git add -p  # stage anything missed
git commit -m "chore: users tab polish"
```
