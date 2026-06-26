<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidate } from '$app/navigation';
  import * as m from '$lib/paraglide/messages';
  import { toastSuccess, toastError } from '$lib/state/ui/toast.svelte';
  import { ensureAliases, invalidateAliases } from '$lib/state/features/aliases.svelte';
  import { can } from '$lib/state/features/permissions.svelte';
  import { Select } from '$lib/components/ui';
  import { MoreVertical, Check, X } from 'lucide-svelte';
  import UserEditor from './UserEditor.svelte';

  type OrgRef = { id: string; name: string; role: string };

  type UserRow = {
    id: string;
    email: string;
    displayName: string | null;
    role: 'user' | 'admin';
    alias: string | null;
    /** RBAC role in the active org (member_roles). */
    memberRole: string;
    createdAt: string | null;
    organizations?: OrgRef[];
  };

  type JoinLink = {
    id: string;
    token: string;
    organization_id: string;
    role: string;
    uses_count: number;
    max_uses: number | null;
    url: string;
  };

  type PendingRequest = {
    id: string;
    email: string;
    message?: string | null;
    organizationId?: string | null;
    requestedRole?: string | null;
    createdAt: string;
  };

  const INVITE_ROLES = ['member', 'admin'];

  type RbacRole = { key: string; name: string; rank: number; description: string | null };

  type OrgOption = { id: string; name: string };

  interface Props {
    initialUsers?: UserRow[];
    rbacRoles?: RbacRole[];
    initialPendingRequests?: PendingRequest[];
    organizations?: OrgOption[];
  }
  let {
    initialUsers = [],
    rbacRoles = [],
    initialPendingRequests = [],
    organizations = [],
  }: Props = $props();
  const hasServerData = $derived(initialUsers.length > 0);

  // svelte-ignore state_referenced_locally
  let users = $state<UserRow[]>(initialUsers);
  let joinLinks = $state<JoinLink[]>([]);
  // svelte-ignore state_referenced_locally
  let pendingRequests = $state<PendingRequest[]>(initialPendingRequests);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let expandedId = $state<string | null>(null);
  let openMenuId = $state<string | null>(null);

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

  // Join-link form state (Better Auth email invitations were retired in favour
  // of shareable join-links — see the Supabase join_link flow).
  let showInvite = $state(false);
  let inviteRole = $state('member');
  let inviteOrg = $state('');
  let inviting = $state(false);
  let inviteError = $state<string | null>(null);
  let lastLinkUrl = $state<string | null>(null);

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

  async function loadJoinLinks() {
    try {
      const res = await fetch('/api/join-links');
      if (!res.ok) return;
      const data = (await res.json()) as { links: Omit<JoinLink, 'url'>[] };
      joinLinks = data.links.map((l) => ({
        ...l,
        url: `${location.origin}/join?token=${l.token}`,
      }));
    } catch {
      // non-fatal
    }
  }

  async function changeMemberRole(userId: string, roleKey: string) {
    const prev = users.find((u) => u.id === userId)?.memberRole ?? 'viewer';
    users = users.map((u) => (u.id === userId ? { ...u, memberRole: roleKey } : u));
    try {
      const res = await fetch(`/api/users/${userId}/member-role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleKey }),
      });
      if (!res.ok) throw new Error(String(res.status));
      void invalidate('settings:team');
    } catch {
      users = users.map((u) => (u.id === userId ? { ...u, memberRole: prev } : u));
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

  async function createJoinLink() {
    const organizationId = inviteOrg || organizations[0]?.id;
    if (!organizationId) {
      inviteError = 'No organization to invite to.';
      return;
    }
    inviting = true;
    inviteError = null;
    try {
      const res = await fetch('/api/join-links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId, role: inviteRole }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
      if (!res.ok || !data.url) throw new Error(data.message ?? `HTTP ${res.status}`);
      lastLinkUrl = data.url;
      void copyLink(data.url);
      toastSuccess('Join link created', 'Copied to clipboard — share it to invite a member.');
      await loadJoinLinks();
    } catch (e) {
      inviteError = (e as Error).message;
      toastError('Could not create join link');
    } finally {
      inviting = false;
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // clipboard may be unavailable (insecure context) — non-fatal
    }
  }

  async function revokeLink(id: string) {
    try {
      const res = await fetch(`/api/join-links/${id}/revoke`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      joinLinks = joinLinks.filter((l) => l.id !== id);
      toastSuccess('Join link revoked');
    } catch {
      toastError('Could not revoke join link');
    }
  }

  // Approve / deny a pending join request. The Team tab's pending list is the
  // Supabase `join_request` system-of-record, so this hits the Supabase-backed
  // approve/deny endpoints (not the Turso-backed /api/join-requests/[id] path).
  let reviewingId = $state<string | null>(null);

  async function reviewRequest(req: PendingRequest, action: 'approve' | 'deny') {
    reviewingId = req.id;
    try {
      let res: Response;
      if (action === 'approve') {
        const organizationId = req.organizationId ?? organizations[0]?.id;
        if (!organizationId) {
          toastError('No organization to grant access to.');
          return;
        }
        res = await fetch(`/api/join-requests/${req.id}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ organizationId, role: req.requestedRole ?? 'user' }),
        });
      } else {
        res = await fetch(`/api/join-requests/${req.id}/deny`, { method: 'POST' });
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { message?: string }).message ?? `HTTP ${res.status}`);
      }
      pendingRequests = pendingRequests.filter((r) => r.id !== req.id);
      toastSuccess(action === 'approve' ? m.notif_approved() : m.notif_denied());
      void invalidate('settings:team');
    } catch (e) {
      toastError((e as Error).message);
    } finally {
      reviewingId = null;
    }
  }

  async function updateUserOrgs(userId: string, orgIds: string[]) {
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationIds: orgIds }),
      });
      if (!res.ok) throw new Error('Failed to update orgs');
      // Refresh local state
      const refreshed = await fetch('/api/users');
      if (refreshed.ok) {
        const data = (await refreshed.json()) as { users: UserRow[] };
        users = data.users;
      }
      toastSuccess('Organizations updated');
    } catch {
      toastError('Failed to update organizations');
    }
  }

  onMount(() => {
    if (!hasServerData) {
      load();
    }
    inviteOrg = organizations[0]?.id ?? '';
    loadJoinLinks();
  });
</script>

<div class="flex-1 overflow-y-auto p-6">
  <div class="max-w-3xl mx-auto">
    <!-- Header -->
    <div class="flex items-center justify-between mb-5">
      <h2 class="text-sm font-semibold text-foreground uppercase tracking-wider">
        {m.users_team()}
      </h2>
    </div>

    <!-- Error / loading -->
    {#if loading}
      <div class="text-muted text-xs py-8 text-center">{m.common_loading()}</div>
    {:else if error}
      <div class="text-destructive text-xs py-4">{error}</div>
    {:else if users.length === 0}
      <div class="text-muted text-xs py-8 text-center">{m.users_noUsers()}</div>
    {:else}
      <div class="bg-card border border-border rounded-lg">
        <table class="w-full text-xs border-collapse">
          <thead>
            <tr class="border-b border-border bg-bg2">
              <th class="text-left px-4 py-2.5 text-muted font-semibold uppercase tracking-wider text-[10px]">{m.users_name()}</th>
              <th class="text-left px-4 py-2.5 text-muted font-semibold uppercase tracking-wider text-[10px]">{m.users_role()}</th>
              <th class="text-left px-4 py-2.5 text-muted font-semibold uppercase tracking-wider text-[10px]">Company</th>
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
                  <Select
                    size="sm"
                    value={u.memberRole}
                    disabled={u.role === 'admin'}
                    title={u.role === 'admin' ? 'Platform admin — full access' : undefined}
                    options={rbacRoles.map((r) => ({ value: r.key, label: r.name }))}
                    onchange={(v) => changeMemberRole(u.id, String(v))}
                  />
                </td>
                <td class="px-4 py-3" onclick={(e) => e.stopPropagation()}>
                  {#if organizations.length === 0}
                    <span class="text-muted text-[10px]">—</span>
                  {:else}
                    <div class="flex items-center gap-1 flex-wrap max-w-[250px]">
                      {#each organizations as org (org.id)}
                        {@const isMember = (u.organizations ?? []).some((o) => o.id === org.id)}
                        <button
                          type="button"
                          class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border cursor-pointer transition-colors
                            {isMember
                              ? 'bg-accent/15 text-accent border-accent/30 hover:bg-accent/25'
                              : 'bg-bg2 text-muted-foreground border-border hover:border-white/20 hover:text-foreground'}"
                          onclick={() => {
                            const current = new Set((u.organizations ?? []).map((o) => o.id));
                            if (current.has(org.id)) {
                              current.delete(org.id);
                            } else {
                              current.add(org.id);
                            }
                            void updateUserOrgs(u.id, Array.from(current));
                          }}
                          title={isMember ? `Member of ${org.name}` : `Add to ${org.name}`}
                        >
                          {org.name}
                        </button>
                      {/each}
                    </div>
                  {/if}
                </td>
                <td class="px-4 py-3 text-right relative" onclick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    class="text-muted hover:text-foreground transition-colors bg-transparent border-none cursor-pointer p-1 rounded-md hover:bg-bg2"
                    onclick={(e) => { e.stopPropagation(); openMenuId = openMenuId === u.id ? null : u.id; }}
                    title="Actions"
                  >
                    <MoreVertical size={14} />
                  </button>
                  {#if openMenuId === u.id}
                    <div
                      class="absolute right-2 top-full mt-1 z-50 w-44 bg-bg2 border border-border rounded-lg shadow-lg overflow-hidden py-1"
                      role="menu"
                      tabindex="-1"
                      onclick={(e) => e.stopPropagation()}
                      onkeydown={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        class="w-full text-left px-3 py-2 text-xs text-foreground hover:bg-bg3 transition-colors"
                        role="menuitem"
                        onclick={() => { toggleExpand(u.id); openMenuId = null; }}
                      >
                        Edit profile
                      </button>
                      <button
                        type="button"
                        class="w-full text-left px-3 py-2 text-xs text-foreground hover:bg-bg3 transition-colors"
                        role="menuitem"
                        onclick={() => { openMenuId = null; }}
                      >
                        Manage permissions
                      </button>
                      <div class="border-t border-border my-1"></div>
                      <button
                        type="button"
                        class="w-full text-left px-3 py-2 text-xs text-destructive hover:bg-destructive/10 transition-colors"
                        role="menuitem"
                        onclick={() => { openMenuId = null; remove(u.id); }}
                      >
                        Delete user
                      </button>
                    </div>
                  {/if}
                </td>
              </tr>
              {#if expandedId === u.id}
                <tr class="border-b border-border/50 bg-bg2/30">
                  <td colspan="4" class="px-4 py-4">
                    <UserEditor
                      user={u}
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

      <!-- Invite section (below table) -->
      {#if can('users:invite')}
        <div class="mt-4 flex justify-end">
          <button
            class="text-xs px-3 py-1.5 rounded-md bg-accent text-white border-none cursor-pointer font-[inherit] font-semibold hover:opacity-90 transition-opacity"
            onclick={() => (showInvite = !showInvite)}
          >
            {showInvite ? m.users_inviteCancelBtn() : m.users_inviteOpen()}
          </button>
        </div>
      {/if}

      {#if showInvite}
        <form
          class="bg-card border border-border rounded-lg p-4 mt-3 space-y-3"
          onsubmit={(e) => { e.preventDefault(); createJoinLink(); }}
        >
          <p class="text-xs font-semibold text-foreground">Create a shareable join link</p>
          <div class="grid grid-cols-2 gap-3">
            {#if organizations.length > 1}
              <Select bind:value={inviteOrg} size="sm">
                {#each organizations as o (o.id)}
                  <option value={o.id}>{o.name}</option>
                {/each}
              </Select>
            {/if}
            <Select bind:value={inviteRole} size="sm">
              {#each INVITE_ROLES as r (r)}
                <option value={r}>{r}</option>
              {/each}
            </Select>
          </div>
          {#if lastLinkUrl}
            <div class="flex items-center gap-2">
              <input
                readonly
                value={lastLinkUrl}
                class="flex-1 bg-bg2 border border-border rounded-md text-foreground px-2.5 py-1.5 text-[11px] font-mono outline-none"
              />
              <button
                type="button"
                class="text-xs px-2.5 py-1.5 rounded-md bg-bg2 border border-border text-foreground cursor-pointer hover:border-accent/40"
                onclick={() => copyLink(lastLinkUrl ?? '')}
              >
                Copy
              </button>
            </div>
          {/if}
          {#if inviteError}
            <p class="text-xs text-destructive">{inviteError}</p>
          {/if}
          <button
            type="submit"
            class="text-xs px-3 py-1.5 rounded-md bg-accent text-white border-none cursor-pointer font-[inherit] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
            disabled={inviting}
          >
            {inviting ? m.users_creating() : 'Generate link'}
          </button>
        </form>
      {/if}
    {/if}

    <!-- Active join links & pending requests -->
    {#if joinLinks.length > 0 || pendingRequests.length > 0}
      <div class="mt-6">
        <h3 class="text-xs font-semibold text-muted uppercase tracking-wider mb-3">
          Pending Access
          {#if joinLinks.length + pendingRequests.length > 0}
            <span class="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-accent/20 text-accent text-[9px] font-bold">{joinLinks.length + pendingRequests.length}</span>
          {/if}
        </h3>

        {#if joinLinks.length > 0}
          <div class="mb-3">
            <h4 class="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Join Links</h4>
            <div class="bg-card border border-border rounded-lg overflow-hidden">
              <table class="w-full text-xs border-collapse">
                <thead>
                  <tr class="border-b border-border bg-bg2">
                    <th class="text-left px-4 py-2 text-muted font-semibold uppercase tracking-wider text-[10px]">Link</th>
                    <th class="text-left px-4 py-2 text-muted font-semibold uppercase tracking-wider text-[10px]">{m.users_role()}</th>
                    <th class="text-left px-4 py-2 text-muted font-semibold uppercase tracking-wider text-[10px]">Uses</th>
                    <th class="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {#each joinLinks as link (link.id)}
                    <tr class="border-b border-border/50 last:border-0 hover:bg-bg2/50 transition-colors">
                      <td class="px-4 py-2.5">
                        <button
                          class="text-accent hover:underline bg-transparent border-none cursor-pointer text-[11px] font-mono p-0 max-w-[220px] truncate inline-block align-bottom"
                          title="Copy link"
                          onclick={() => copyLink(link.url)}
                        >
                          {link.url}
                        </button>
                      </td>
                      <td class="px-4 py-2.5 text-muted">{link.role}</td>
                      <td class="px-4 py-2.5 text-muted">{link.uses_count}{link.max_uses != null ? `/${link.max_uses}` : ''}</td>
                      <td class="px-4 py-2.5 text-right">
                        <button
                          class="text-muted hover:text-destructive transition-colors bg-transparent border-none cursor-pointer text-xs font-[inherit]"
                          onclick={() => revokeLink(link.id)}
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </div>
        {/if}

        {#if pendingRequests.length > 0}
          <div>
            <h4 class="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Join Requests</h4>
            <div class="bg-card border border-border rounded-lg overflow-hidden">
              <table class="w-full text-xs border-collapse">
                <thead>
                  <tr class="border-b border-border bg-bg2">
                    <th class="text-left px-4 py-2 text-muted font-semibold uppercase tracking-wider text-[10px]">{m.users_email()}</th>
                    <th class="text-left px-4 py-2 text-muted font-semibold uppercase tracking-wider text-[10px]">Message</th>
                    <th class="text-left px-4 py-2 text-muted font-semibold uppercase tracking-wider text-[10px]">{m.users_status()}</th>
                    <th class="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {#each pendingRequests as req (req.id)}
                    <tr class="border-b border-border/50 last:border-0 hover:bg-bg2/50 transition-colors">
                      <td class="px-4 py-2.5 text-foreground">{req.email}</td>
                      <td class="px-4 py-2.5 text-muted max-w-[200px] truncate">{req.message ?? '—'}</td>
                      <td class="px-4 py-2.5">
                        <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-500/10 text-orange-400 border border-orange-500/20">
                          Awaiting review
                        </span>
                      </td>
                      <td class="px-4 py-2.5">
                        <div class="flex items-center justify-end gap-2">
                          <span class="text-muted text-[10px] mr-1">{new Date(req.createdAt).toLocaleDateString()}</span>
                          <button
                            type="button"
                            class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-success/10 text-success border border-success/20 hover:bg-success/15 transition-colors cursor-pointer disabled:opacity-50"
                            disabled={reviewingId === req.id}
                            onclick={() => reviewRequest(req, 'approve')}
                            title={m.notif_approve()}
                          >
                            <Check size={13} />
                            {m.notif_approve()}
                          </button>
                          <button
                            type="button"
                            class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/15 transition-colors cursor-pointer disabled:opacity-50"
                            disabled={reviewingId === req.id}
                            onclick={() => reviewRequest(req, 'deny')}
                            title={m.notif_deny()}
                          >
                            <X size={13} />
                            {m.notif_deny()}
                          </button>
                        </div>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
