<script lang="ts">
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';
  import { authClient } from '$lib/auth';
  import { toastSuccess, toastError } from '$lib/state/ui/toast.svelte';

  type UserRow = {
    id: string;
    email: string;
    displayName: string | null;
    role: 'user' | 'admin';
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

  let users = $state<UserRow[]>([]);
  let invitations = $state<PendingInvite[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

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
    load();
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
      <button
        class="text-xs px-3 py-1.5 rounded-md bg-accent text-white border-none cursor-pointer font-[inherit] font-semibold hover:opacity-90 transition-opacity"
        onclick={() => (showInvite = !showInvite)}
      >
        {showInvite ? m.users_inviteCancelBtn() : m.users_inviteOpen()}
      </button>
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
          <select
            class="bg-bg2 border border-border rounded-md text-foreground px-2.5 py-1.5 text-xs font-[inherit] outline-none cursor-pointer focus:border-accent"
            bind:value={inviteRole}
          >
            {#each INVITE_ROLES as r (r)}
              <option value={r}>{r}</option>
            {/each}
          </select>
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
                <th class="text-left px-4 py-2.5 text-muted font-semibold uppercase tracking-wider text-[10px]">Status</th>
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
