<script lang="ts">
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';

  type UserRow = {
    id: string;
    email: string;
    displayName: string | null;
    role: 'user' | 'admin';
    createdAt: string | null;
  };

  const ROLES: UserRow['role'][] = ['user', 'admin'];

  let users = $state<UserRow[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

  // Create form state
  let showCreate = $state(false);
  let createEmail = $state('');
  let createPassword = $state('');
  let createName = $state('');
  let createRole = $state<UserRow['role']>('user');
  let creating = $state(false);
  let createError = $state<string | null>(null);

  async function load() {
    loading = true;
    error = null;
    try {
      const res = await fetch('/api/users');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { users: UserRow[] };
      users = data.users;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  async function changeRole(userId: string, role: UserRow['role']) {
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (res.ok) {
        users = users.map((u) => (u.id === userId ? { ...u, role } : u));
      } else {
        error = m.users_errorUpdateRole({ status: res.status });
      }
    } catch {
      error = m.users_errorUpdateRole({ status: 'unknown' });
    }
  }

  async function remove(userId: string) {
    if (!confirm(m.users_confirmRemove())) return;
    try {
      const res = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
      if (res.ok) {
        users = users.filter((u) => u.id !== userId);
      } else {
        const d = await res.json().catch(() => ({}));
        error = (d as { message?: string }).message ?? m.users_errorRemove();
      }
    } catch {
      error = m.users_errorRemove();
    }
  }

  async function create() {
    if (!createEmail || !createPassword) return;
    creating = true;
    createError = null;
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: createEmail,
          password: createPassword,
          displayName: createName || undefined,
          role: createRole,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { message?: string }).message ?? `HTTP ${res.status}`);
      }
      showCreate = false;
      createEmail = '';
      createPassword = '';
      createName = '';
      createRole = 'user';
      await load();
    } catch (e) {
      createError = (e as Error).message;
    } finally {
      creating = false;
    }
  }

  onMount(load);
</script>

<div class="flex-1 overflow-y-auto p-6">
  <div class="max-w-3xl mx-auto">
    <!-- Header -->
    <div class="flex items-center justify-between mb-5">
      <h2 class="text-sm font-semibold text-foreground uppercase tracking-wider">
        {m.users_team()}
      </h2>
      <button
        class="text-xs px-3 py-1.5 rounded-md bg-accent text-white border-none cursor-pointer font-[inherit] font-semibold hover:opacity-90 transition-opacity"
        onclick={() => (showCreate = !showCreate)}
      >
        {showCreate ? m.users_inviteCancelBtn() : m.users_inviteOpen()}
      </button>
    </div>

    <!-- Create user form -->
    {#if showCreate}
      <form
        class="bg-card border border-border rounded-lg p-4 mb-5 space-y-3"
        onsubmit={(e) => { e.preventDefault(); create(); }}
      >
        <p class="text-xs font-semibold text-foreground">{m.users_newUser()}</p>
        <div class="grid grid-cols-2 gap-3">
          <input
            class="bg-bg2 border border-border rounded-md text-foreground px-2.5 py-1.5 text-xs font-[inherit] outline-none focus:border-accent placeholder:text-muted"
            type="email"
            placeholder={m.users_emailRequired()}
            bind:value={createEmail}
          />
          <input
            class="bg-bg2 border border-border rounded-md text-foreground px-2.5 py-1.5 text-xs font-[inherit] outline-none focus:border-accent placeholder:text-muted"
            type="password"
            placeholder={m.users_passwordRequired()}
            bind:value={createPassword}
          />
          <input
            class="bg-bg2 border border-border rounded-md text-foreground px-2.5 py-1.5 text-xs font-[inherit] outline-none focus:border-accent placeholder:text-muted"
            type="text"
            placeholder={m.users_displayName()}
            bind:value={createName}
          />
          <select
            class="bg-bg2 border border-border rounded-md text-foreground px-2.5 py-1.5 text-xs font-[inherit] outline-none cursor-pointer focus:border-accent"
            bind:value={createRole}
          >
            {#each ROLES as r (r)}
              <option value={r}>{r}</option>
            {/each}
          </select>
        </div>
        {#if createError}
          <p class="text-xs text-destructive">{createError}</p>
        {/if}
        <button
          type="submit"
          class="text-xs px-3 py-1.5 rounded-md bg-accent text-white border-none cursor-pointer font-[inherit] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
          disabled={creating || !createEmail || !createPassword}
        >
          {creating ? m.users_creating() : m.users_createUser()}
        </button>
      </form>
    {/if}

    <!-- Error / loading -->
    {#if loading}
      <div class="text-muted text-xs py-8 text-center">{m.common_loading()}</div>
    {:else if error}
      <div class="text-destructive text-xs py-4">{error}</div>
    {:else if users.length === 0}
      <div class="text-muted text-xs py-8 text-center">{m.users_noUsers()}</div>
    {:else}
      <div class="bg-card border border-border rounded-lg overflow-hidden">
        <table class="w-full text-xs border-collapse">
          <thead>
            <tr class="border-b border-border bg-bg2">
              <th class="text-left px-4 py-2.5 text-muted font-semibold uppercase tracking-wider text-[10px]">{m.users_name()}</th>
              <th class="text-left px-4 py-2.5 text-muted font-semibold uppercase tracking-wider text-[10px]">{m.users_role()}</th>
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
                    title={m.users_removeFromTenant()}
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
