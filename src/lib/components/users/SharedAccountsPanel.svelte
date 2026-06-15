<script lang="ts">
  import { onMount } from 'svelte';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
  import { Building2, User, ChevronDown, ChevronRight } from 'lucide-svelte';

  type Member = {
    id: string;
    email: string;
    displayName: string | null;
    accountType?: string;
  };
  type AdminIdentity = {
    id: string;
    provider: string;
    externalId: string;
    displayName: string | null;
    shareable: boolean;
  };

  let members = $state<Member[]>([]);
  let loading = $state(true);
  let expanded = $state<string | null>(null);
  let identitiesByUser = $state<Record<string, AdminIdentity[]>>({});
  let busy = $state<string | null>(null);

  async function load() {
    loading = true;
    try {
      const res = await fetch('/api/users');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      members = ((await res.json()) as { users: Member[] }).users;
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Failed to load members');
    } finally {
      loading = false;
    }
  }

  async function setAccountType(m: Member, accountType: 'person' | 'service') {
    busy = m.id;
    try {
      const res = await fetch('/api/shared-identities/manage', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'account_type', profileId: m.id, accountType }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'failed');
      members = members.map((x) => (x.id === m.id ? { ...x, accountType } : x));
      toastSuccess(accountType === 'service' ? 'Marked as shared account' : 'Marked as personal');
      if (accountType === 'service' && expanded !== m.id) toggle(m);
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Could not update');
    } finally {
      busy = null;
    }
  }

  async function loadIdentities(userId: string) {
    const res = await fetch(`/api/shared-identities/manage?profileId=${userId}`);
    if (res.ok) {
      identitiesByUser[userId] = ((await res.json()) as { identities: AdminIdentity[] }).identities;
    }
  }

  function toggle(m: Member) {
    if (expanded === m.id) {
      expanded = null;
      return;
    }
    expanded = m.id;
    if (!identitiesByUser[m.id]) void loadIdentities(m.id);
  }

  async function setShareable(userId: string, identity: AdminIdentity, shareable: boolean) {
    busy = identity.id;
    try {
      const res = await fetch('/api/shared-identities/manage', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'shareable', identityId: identity.id, shareable }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'failed');
      identitiesByUser[userId] = (identitiesByUser[userId] ?? []).map((i) =>
        i.id === identity.id ? { ...i, shareable } : i,
      );
      toastSuccess(shareable ? 'Shared with the org' : 'Sharing revoked');
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Could not update');
    } finally {
      busy = null;
    }
  }

  onMount(load);
</script>

<div class="max-w-3xl mx-auto mt-8">
  <h3 class="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Shared accounts</h3>
  <p class="text-[11px] text-muted-foreground mb-3">
    Mark a business account (e.g. a shared inbox) as <b>shared</b>, then expose its identities so
    org members can opt them into their own feed.
  </p>

  {#if loading}
    <div class="text-muted text-xs py-6 text-center">Loading…</div>
  {:else}
    <div class="bg-card border border-border rounded-lg divide-y divide-border/60">
      {#each members as m (m.id)}
        {@const isService = m.accountType === 'service'}
        <div>
          <div class="flex items-center gap-3 px-4 py-3">
            <button
              class="grid place-items-center h-7 w-7 rounded-full shrink-0 bg-transparent border-none cursor-pointer
                {isService ? 'text-accent' : 'text-muted'}"
              title={isService ? 'Shared account' : 'Personal account'}
              onclick={() => toggle(m)}
            >
              {#if isService}<Building2 size={15} />{:else}<User size={15} />{/if}
            </button>
            <span class="flex-1 min-w-0">
              <span class="block text-sm text-foreground truncate">{m.displayName ?? m.email}</span>
              <span class="block text-[11px] text-muted-foreground truncate">{m.email}</span>
            </span>
            <select
              class="bg-transparent border border-border rounded-md text-foreground px-2 py-1 text-[11px] outline-none cursor-pointer focus:border-accent disabled:opacity-50"
              value={isService ? 'service' : 'person'}
              disabled={busy === m.id}
              onchange={(e) =>
                setAccountType(m, (e.currentTarget as HTMLSelectElement).value as 'person' | 'service')}
            >
              <option value="person">Personal</option>
              <option value="service">Shared</option>
            </select>
            {#if isService}
              <button
                class="grid place-items-center h-6 w-6 rounded text-muted hover:text-foreground bg-transparent border-none cursor-pointer"
                onclick={() => toggle(m)}
                title="Manage shared identities"
              >
                {#if expanded === m.id}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
              </button>
            {/if}
          </div>

          {#if expanded === m.id && isService}
            <div class="px-4 pb-3 pl-14">
              {#if !identitiesByUser[m.id]}
                <div class="text-muted text-[11px] py-1">Loading identities…</div>
              {:else if identitiesByUser[m.id].length === 0}
                <div class="text-muted text-[11px] py-1">No identities to share.</div>
              {:else}
                <div class="flex flex-col gap-1.5">
                  {#each identitiesByUser[m.id] as id (id.id)}
                    <label class="flex items-center gap-2 text-[11px] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={id.shareable}
                        disabled={busy === id.id}
                        onchange={(e) =>
                          setShareable(m.id, id, (e.currentTarget as HTMLInputElement).checked)}
                      />
                      <span class="capitalize text-foreground">{id.provider}</span>
                      <span class="text-muted-foreground truncate">{id.externalId}</span>
                    </label>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
