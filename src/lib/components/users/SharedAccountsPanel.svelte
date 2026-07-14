<script lang="ts">
  import { onMount } from 'svelte';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
  import { Building2, User, ChevronDown, ChevronRight } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { Button, Select } from '$lib/components/ui';

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
      toastError(e instanceof Error ? e.message : m.shared_loadMembersFailed());
    } finally {
      loading = false;
    }
  }

  async function setAccountType(member: Member, accountType: 'person' | 'service') {
    busy = member.id;
    try {
      const res = await fetch('/api/shared-identities/manage', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'account_type', profileId: member.id, accountType }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'failed');
      members = members.map((x) => (x.id === member.id ? { ...x, accountType } : x));
      toastSuccess(accountType === 'service' ? m.shared_markedShared() : m.shared_markedPersonal());
      if (accountType === 'service' && expanded !== member.id) toggle(member);
    } catch (e) {
      toastError(e instanceof Error ? e.message : m.shared_toastError());
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

  function toggle(member: Member) {
    if (expanded === member.id) {
      expanded = null;
      return;
    }
    expanded = member.id;
    if (!identitiesByUser[member.id]) void loadIdentities(member.id);
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
      toastSuccess(shareable ? m.shared_sharedWithOrg() : m.shared_sharingRevoked());
    } catch (e) {
      toastError(e instanceof Error ? e.message : m.shared_toastError());
    } finally {
      busy = null;
    }
  }

  onMount(load);
</script>

<div class="max-w-3xl mx-auto mt-8">
  <h3 class="text-xs font-semibold text-muted uppercase tracking-wider mb-1">
    {m.shared_accountsTitle()}
  </h3>
  <p class="text-[length:var(--font-size-label)] text-muted-foreground mb-3">{m.shared_accountsDesc()}</p>

  {#if loading}
    <div class="text-muted text-xs py-6 text-center">{m.common_loading()}</div>
  {:else}
    <div class="bg-card border border-border rounded-lg divide-y divide-border/60">
      {#each members as member (member.id)}
        {@const isService = member.accountType === 'service'}
        <div>
          <div class="flex items-center gap-3 px-4 py-3">
            <Button variant="ghost" size="xs"
              class="grid place-items-center h-7 w-7 rounded-full shrink-0 bg-transparent border-none cursor-pointer
                {isService ? 'text-accent' : 'text-muted'}"
              title={isService ? m.shared_accountTypeShared() : m.shared_accountTypePersonal()}
              onclick={() => toggle(member)}
            >
              {#if isService}<Building2 size={15} />{:else}<User size={15} />{/if}
            </Button>
            <span class="flex-1 min-w-0">
              <span class="block text-sm text-foreground truncate"
                >{member.displayName ?? member.email}</span
              >
              <span class="block text-[length:var(--font-size-label)] text-muted-foreground truncate">{member.email}</span>
            </span>
            <Select
              fieldClass="w-28 shrink-0"
              size="xs"
              value={isService ? 'service' : 'person'}
              disabled={busy === member.id}
              options={[
                { value: 'person', label: m.shared_optionPersonal() },
                { value: 'service', label: m.shared_optionShared() },
              ]}
              onchange={(value) => setAccountType(member, value as 'person' | 'service')}
            />
            {#if isService}
              <Button variant="ghost" size="xs"
                class="grid place-items-center h-6 w-6 rounded text-muted hover:text-foreground bg-transparent border-none cursor-pointer"
                onclick={() => toggle(member)}
                title={m.shared_manageIdentities()}
              >
                {#if expanded === member.id}<ChevronDown size={14} />{:else}<ChevronRight
                    size={14}
                  />{/if}
              </Button>
            {/if}
          </div>

          {#if expanded === member.id && isService}
            <div class="px-4 pb-3 pl-14">
              {#if !identitiesByUser[member.id]}
                <div class="text-muted text-[length:var(--font-size-label)] py-1">{m.shared_loadingIdentities()}</div>
              {:else if identitiesByUser[member.id].length === 0}
                <div class="text-muted text-[length:var(--font-size-label)] py-1">{m.shared_noIdentities()}</div>
              {:else}
                <div class="flex flex-col gap-1.5">
                  {#each identitiesByUser[member.id] as id (id.id)}
                    <label class="flex items-center gap-2 text-[length:var(--font-size-label)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={id.shareable}
                        disabled={busy === id.id}
                        onchange={(e) =>
                          setShareable(member.id, id, (e.currentTarget as HTMLInputElement).checked)}
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
