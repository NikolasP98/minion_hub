<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidate } from '$app/navigation';
  import * as m from '$lib/paraglide/messages';
  import { authClient } from '$lib/auth';
  import { toastSuccess, toastError } from '$lib/state/ui/toast.svelte';
  import { ensureAliases, invalidateAliases } from '$lib/state/features/aliases.svelte';
  import { can } from '$lib/state/features/permissions.svelte';
  import { Select } from '$lib/components/ui';
  import UserEditor from './UserEditor.svelte';

  type UserRow = {
    id: string;
    email: string;
    displayName: string | null;
    role: 'user' | 'admin';
    alias: string | null;
    roleId: string | null;
    createdAt: string | null;
  };

  type PendingInvite = {
    id: string;
    email: string;
    role: string;
    status: string;
    expiresAt: Date | string;
  };

  const ROLES: UserRow['role'][] = ['user', 'admin'];
  const INVITE_ROLES = ['member', 'admin'];

  type CustomRole = { id: string; name: string; isSystem: boolean; description?: string | null; permissions?: string[]; memberCount?: number };

  // Server-loaded initial data (passed by /settings/team/+page.server.ts).
  // When the component is mounted on a route that didn't preload, both default
  // to empty arrays and the component falls back to client-side fetches.
  interface Props {
    initialUsers?: UserRow[];
    initialCustomRoles?: CustomRole[];
  }
  let { initialUsers = [], initialCustomRoles = [] }: Props = $props();
  const hasServerData = $derived(initialUsers.length > 0 || initialCustomRoles.length > 0);

  let customRoles = $state<CustomRole[]>(initialCustomRoles);

  let users = $state<UserRow[]>(initialUsers);
  let invitations = $state<PendingInvite[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let expandedId = $state<string | null>(null);

  function toggleExpand(id: string) {
    expandedId = expandedId === id ? null : id;
  }

  async function saveProfile(userId: string, patch: Partial<UserRow>) {
    const res = await fetch(`/api/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toastError((d as { message?: string }).message ?? 'save failed');
      return;
    }
    users = users.map((u) => (u.id === userId ? { ...u, ...patch } : u));
    invalidateAliases();
    void ensureAliases();
    toastSuccess(m.users_team());
    expandedId = null;
    void invalidate('settings:team');
  }

  // Invite form state
  let showInvite = $state(false);
  let inviteEmail = $state('');
  let inviteRole = $state('member');
  let inviting = $state(false);
  let inviteError = $state<string | null>(null);

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

  async function loadInvitations() {
    try {
      const result = await authClient.organization.listInvitations();
      if (result.data) {
        invitations = result.data
          .filter((inv) => inv.status === 'pending')
          .map((inv) => ({
            id: inv.id,
            email: inv.email,
            role: inv.role ?? 'member',
            status: inv.status as string,
            expiresAt: inv.expiresAt,
          }));
      }
    } catch {
      // non-fatal — invitations just won't show
    }
  }

  async function loadCustomRoles() {
    const res = await fetch('/api/roles');
    if (res.ok) customRoles = ((await res.json()) as { roles: CustomRole[] }).roles;
  }

  async function changeRoleId(userId: string, roleId: string | null) {
    const res = await fetch(`/api/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roleId }),
    });
    if (res.ok) {
      users = users.map((u) => (u.id === userId ? { ...u, roleId } : u));
      void invalidate('settings:team');
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

  async function sendInvite() {
    if (!inviteEmail) return;
    inviting = true;
    inviteError = null;
    try {
      const result = await authClient.organization.inviteMember({
        email: inviteEmail,
        role: inviteRole as 'member' | 'admin',
      });
      if (result.error) {
        throw new Error(result.error.message ?? 'Unknown error');
      }
      toastSuccess(m.invite_sent(), m.invite_sentTo({ email: inviteEmail }));
      showInvite = false;
      inviteEmail = '';
      inviteRole = 'member';
      await loadInvitations();
    } catch (e) {
      inviteError = (e as Error).message;
      toastError(m.invite_errorSending());
    } finally {
      inviting = false;
    }
  }

  async function cancelInvite(invitationId: string) {
    try {
      await authClient.organization.cancelInvitation({ invitationId });
      invitations = invitations.filter((i) => i.id !== invitationId);
      toastSuccess(m.invite_cancelled());
    } catch {
      toastError(m.invite_errorCancelling());
    }
  }

  onMount(() => {
    // When initial server data is provided (the file-routed page), skip the
    // users + customRoles refetches — they're already in `users`/`customRoles`.
    // Invitations always need a client fetch because Better Auth's organization
    // API is exposed via authClient (server invocation requires extra wiring).
    if (!hasServerData) {
      load();
      loadCustomRoles();
    }
    loadInvitations();
  });
</script>

<div class="flex-1 overflow-y-auto p-6">
  <div class="max-w-3xl mx-auto">
    <!-- Header -->
    <div class="flex items-center justify-between mb-5">
      <h2 class="text-sm font-semibold text-foreground uppercase tracking-wider">
        {m.users_team()}
      </h2>
      {#if can('users:invite')}
        <button
          class="text-xs px-3 py-1.5 rounded-md bg-accent text-white border-none cursor-pointer font-[inherit] font-semibold hover:opacity-90 transition-opacity"
          onclick={() => (showInvite = !showInvite)}
        >
          {showInvite ? m.users_inviteCancelBtn() : m.users_inviteOpen()}
        </button>
      {/if}
    </div>

    <!-- Invite form -->
    {#if showInvite}
      <form
        class="bg-card border border-border rounded-lg p-4 mb-5 space-y-3"
        onsubmit={(e) => { e.preventDefault(); sendInvite(); }}
      >
        <p class="text-xs font-semibold text-foreground">{m.users_invite()}</p>
        <div class="grid grid-cols-2 gap-3">
          <input
            class="bg-bg2 border border-border rounded-md text-foreground px-2.5 py-1.5 text-xs font-[inherit] outline-none focus:border-accent placeholder:text-muted"
            type="email"
            placeholder={m.users_inviteEmail()}
            bind:value={inviteEmail}
            required
          />
          <Select bind:value={inviteRole} size="sm">
            {#each INVITE_ROLES as r (r)}
              <option value={r}>{r}</option>
            {/each}
          </Select>
        </div>
        {#if inviteError}
          <p class="text-xs text-destructive">{inviteError}</p>
        {/if}
        <button
          type="submit"
          class="text-xs px-3 py-1.5 rounded-md bg-accent text-white border-none cursor-pointer font-[inherit] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
          disabled={inviting || !inviteEmail}
        >
          {inviting ? m.users_creating() : m.users_inviteSubmit()}
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
              <tr
                class="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                onclick={() => toggleExpand(u.id)}
              >
                <td class="px-4 py-3">
                  <div class="font-semibold text-foreground">{u.displayName ?? u.email}</div>
                  {#if u.displayName}
                    <div class="text-muted text-[10px] mt-0.5">{u.email}</div>
                  {/if}
                  {#if u.alias}
                    <div class="text-accent text-[10px] mt-0.5">@{u.alias}</div>
                  {/if}
                </td>
                <td class="px-4 py-3" onclick={(e) => e.stopPropagation()}>
                  <select
                    class="bg-transparent border border-border rounded-md text-foreground px-2 py-1 text-[11px] font-[inherit] outline-none cursor-pointer focus:border-accent"
                    value={u.roleId ?? `legacy:${u.role}`}
                    onchange={(e) => {
                      const v = (e.currentTarget as HTMLSelectElement).value;
                      if (v.startsWith('legacy:')) {
                        changeRole(u.id, v.slice(7) as UserRow['role']);
                      } else {
                        changeRoleId(u.id, v);
                      }
                    }}
                  >
                    <optgroup label="Built-in">
                      <option value="legacy:user">user</option>
                      <option value="legacy:admin">admin</option>
                    </optgroup>
                    {#if customRoles.filter((r) => !r.isSystem).length > 0}
                      <optgroup label="Custom">
                        {#each customRoles.filter((r) => !r.isSystem) as r (r.id)}
                          <option value={r.id}>{r.name}</option>
                        {/each}
                      </optgroup>
                    {/if}
                  </select>
                </td>
                <td class="px-4 py-3 text-right" onclick={(e) => e.stopPropagation()}>
                  <button
                    class="text-muted hover:text-destructive transition-colors bg-transparent border-none cursor-pointer text-xs font-[inherit]"
                    onclick={() => remove(u.id)}
                    title={m.users_removeFromTenant()}
                  >
                    ✕
                  </button>
                </td>
              </tr>
              {#if expandedId === u.id}
                <tr class="border-b border-border/50 bg-bg2/30">
                  <td colspan="3" class="px-4 py-4">
                    <UserEditor
                      user={u}
                      customRoles={customRoles}
                      onSave={(patch) => saveProfile(u.id, patch)}
                      onCancel={() => (expandedId = null)}
                    />
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

    <!-- Pending Invitations -->
    {#if invitations.length > 0}
      <div class="mt-6">
        <h3 class="text-xs font-semibold text-muted uppercase tracking-wider mb-3">
          {m.invite_pendingTitle()}
        </h3>
        <div class="bg-card border border-border rounded-lg overflow-hidden">
          <table class="w-full text-xs border-collapse">
            <thead>
              <tr class="border-b border-border bg-bg2">
                <th class="text-left px-4 py-2.5 text-muted font-semibold uppercase tracking-wider text-[10px]">{m.users_email()}</th>
                <th class="text-left px-4 py-2.5 text-muted font-semibold uppercase tracking-wider text-[10px]">{m.users_role()}</th>
                <th class="text-left px-4 py-2.5 text-muted font-semibold uppercase tracking-wider text-[10px]">{m.users_status()}</th>
                <th class="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {#each invitations as inv (inv.id)}
                <tr class="border-b border-border/50 last:border-0 hover:bg-bg2/50 transition-colors">
                  <td class="px-4 py-3 text-foreground">{inv.email}</td>
                  <td class="px-4 py-3 text-muted">{inv.role}</td>
                  <td class="px-4 py-3">
                    <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                      {m.invite_statusPending()}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-right">
                    <button
                      class="text-muted hover:text-destructive transition-colors bg-transparent border-none cursor-pointer text-xs font-[inherit]"
                      onclick={() => cancelInvite(inv.id)}
                    >
                      {m.invite_cancelInvite()}
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}
  </div>
</div>
