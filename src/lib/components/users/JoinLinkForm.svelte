<script lang="ts">
  // Shareable join-link creator (Better Auth email invitations were retired in
  // favour of join-links — see the Supabase join_link flow). Shared by
  // settings/team (TeamTab) and /team People → Invite.
  // TODO(handoff): raw fetch + hardcoded EN strings moved verbatim from TeamTab —
  // migrate to `jsonMutation` + paraglide keys (proposals/2026-09-03-hub-team-hr-tabs-followups.md).
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';
  import { toastSuccess, toastError } from '$lib/state/ui/toast.svelte';
  import { Button, Select } from '$lib/components/ui';

  type OrgOption = { id: string; name: string };

  const INVITE_ROLES = ['member', 'admin'];

  let {
    organizations = [],
    onCreated,
  }: {
    organizations?: OrgOption[];
    /** Fires after a link is created (TeamTab refreshes its join-links list). */
    onCreated?: () => void | Promise<void>;
  } = $props();

  let inviteRole = $state('member');
  let inviteOrg = $state('');
  let inviting = $state(false);
  let inviteError = $state<string | null>(null);
  let lastLinkUrl = $state<string | null>(null);

  onMount(() => {
    inviteOrg = organizations[0]?.id ?? '';
  });

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
      await onCreated?.();
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
</script>

<form
  class="bg-card border border-border rounded-lg p-4 space-y-3"
  onsubmit={(e) => {
    e.preventDefault();
    createJoinLink();
  }}
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
        class="flex-1 bg-bg2 border border-border rounded-md text-foreground px-2.5 py-1.5 text-[length:var(--font-size-label)] font-mono outline-none"
      />
      <Button
        variant="ghost"
        size="xs"
        type="button"
        class="text-xs px-2.5 py-1.5 rounded-md bg-bg2 border border-border text-foreground cursor-pointer hover:border-accent/40"
        onclick={() => copyLink(lastLinkUrl ?? '')}
      >
        Copy
      </Button>
    </div>
  {/if}
  {#if inviteError}
    <p class="text-xs text-destructive">{inviteError}</p>
  {/if}
  <Button
    variant="primary"
    size="sm"
    type="submit"
    class="text-xs px-3 py-1.5 rounded-md bg-accent text-accent-foreground border-none cursor-pointer font-[inherit] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
    disabled={inviting}
  >
    {inviting ? m.users_creating() : 'Generate link'}
  </Button>
</form>
