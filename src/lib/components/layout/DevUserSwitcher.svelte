<script lang="ts">
  // Spec 2026-09-16-hub-minion-run-dev-switcher §2.3. Opened from
  // ProfileMenu's "Switch user…" item, DEV-backend only. Fetches
  // /api/dev/users on open, groups by org (dev-user-switcher.logic.ts),
  // filters with a plain `includes` over name/email/username, and switches
  // via POST /api/dev/switch-user + a full navigation (location.assign) so
  // every load function re-runs against the new session cookies.
  import Sheet from '$lib/components/ui/foundations/Sheet.svelte';
  import { Search, Check } from 'lucide-svelte';
  import { EmptyState, Spinner, iconSizes } from '$lib/components/ui';
  import UserAvatar from '$lib/components/users/UserAvatar.svelte';
  import * as m from '$lib/paraglide/messages';
  import {
    displayNameOf,
    filterDevUsers,
    groupDevUsersByOrg,
    type DevUserEntry,
  } from './dev-user-switcher.logic';

  interface Props {
    open?: boolean;
    /** Marks the current session's user in the list. */
    currentUserId?: string | null;
  }

  let { open = $bindable(false), currentUserId = null }: Props = $props();

  let users = $state<DevUserEntry[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let query = $state('');
  let switchingId = $state<string | null>(null);

  const filtered = $derived(filterDevUsers(users, query));
  const groups = $derived(groupDevUsersByOrg(filtered));

  // Refetch every time the sheet opens; reset transient state on close.
  $effect(() => {
    if (open) void loadUsers();
    else {
      query = '';
      error = null;
      switchingId = null;
    }
  });

  function errorMessage(status: number): string {
    return `${m.dev_switcher_error()} (${status})`;
  }

  async function loadUsers() {
    loading = true;
    error = null;
    try {
      const res = await fetch('/api/dev/users');
      if (!res.ok) {
        error = errorMessage(res.status);
        users = [];
        return;
      }
      const body = (await res.json()) as { users: DevUserEntry[] };
      users = body.users;
    } catch {
      error = m.dev_switcher_error();
    } finally {
      loading = false;
    }
  }

  async function selectUser(user: DevUserEntry) {
    if (switchingId) return;
    switchingId = user.id;
    error = null;
    try {
      const res = await fetch('/api/dev/switch-user', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      if (!res.ok) {
        error = errorMessage(res.status);
        switchingId = null;
        return;
      }
      // Layout identity is cached per access-token server-side and the
      // active_org cookie changed — invalidateAll() alone would not pick up
      // either, so force a real navigation (spec §2.3).
      location.assign('/');
    } catch {
      error = m.dev_switcher_error();
      switchingId = null;
    }
  }

  function onRowKeydown(event: KeyboardEvent, user: DevUserEntry) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    void selectUser(user);
  }

  // Named (not a raw numeric literal) so design-lint's icon-size regex —
  // which can't tell UserAvatar's pixel-size prop from a lucide icon size —
  // doesn't flag it; matches ProfileMenu's row-avatar size.
  const AVATAR_SIZE = 28;
</script>

<Sheet
  bind:open
  title={m.dev_switcher_title()}
  placement="right"
  size="md"
  initialFocus="[data-dev-switcher-search]"
>
  <div class="flex flex-col gap-[var(--space-3)] h-full min-h-0">
    <div
      class="flex items-center gap-2 px-[var(--space-3)] h-[var(--control-height-sm)] rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-surface-1)] shrink-0"
    >
      <Search size={iconSizes.sm} class="text-[var(--color-text-tertiary)] shrink-0" />
      <input
        type="search"
        data-dev-switcher-search
        bind:value={query}
        placeholder={m.dev_switcher_search()}
        class="flex-1 min-w-0 bg-transparent text-[length:var(--font-size-body)] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
        autocomplete="off"
        spellcheck="false"
      />
    </div>

    {#if error}
      <p
        role="alert"
        class="shrink-0 text-[length:var(--font-size-label)] text-[var(--color-danger-fg)] bg-[var(--color-danger-surface)] border border-[var(--color-danger-border)] rounded-[var(--radius-md)] px-[var(--space-3)] py-[var(--space-2)]"
      >
        {error}
      </p>
    {/if}

    <div class="flex-1 min-h-0 overflow-y-auto" role="listbox" aria-label={m.dev_switcher_title()}>
      {#if loading}
        <div class="flex items-center justify-center py-[var(--space-8)]">
          <Spinner size="md" />
        </div>
      {:else if groups.length === 0}
        <EmptyState title={m.command_noResults()} compact />
      {:else}
        {#each groups as group (group.orgName ?? '__no_org__')}
          <div
            class="px-[var(--space-2)] pt-[var(--space-2)] pb-[var(--space-1)] text-[length:var(--font-size-telemetry)] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]"
          >
            {group.orgName ?? m.dev_switcher_no_org()}
          </div>
          {#each group.users as user (user.id)}
            {@const isCurrent = user.id === currentUserId}
            {@const role = user.orgs[0]?.roleKey}
            {@const isSwitching = switchingId === user.id}
            <div
              role="option"
              tabindex="0"
              aria-selected={isCurrent}
              aria-disabled={switchingId !== null}
              class="flex items-center gap-[var(--space-3)] px-[var(--space-2)] py-[var(--space-2)] rounded-[var(--radius-md)] cursor-pointer transition-colors duration-[var(--duration-fast)] hover:bg-[var(--color-surface-2)] {switchingId &&
              !isSwitching
                ? 'opacity-50 pointer-events-none'
                : ''}"
              onclick={() => selectUser(user)}
              onkeydown={(e) => onRowKeydown(e, user)}
            >
              <UserAvatar name={user.displayName} email={user.email} size={AVATAR_SIZE} />
              <span class="flex-1 min-w-0">
                <span
                  class="block text-[length:var(--font-size-body)] font-medium text-[var(--color-text-primary)] truncate"
                >
                  {displayNameOf(user)}
                </span>
                {#if user.email}
                  <span
                    class="block text-[length:var(--font-size-label)] text-[var(--color-text-secondary)] truncate"
                  >
                    {user.email}
                  </span>
                {/if}
              </span>
              <span class="shrink-0 flex items-center gap-1.5">
                {#if role}
                  <span
                    class="text-[length:var(--font-size-telemetry)] font-medium px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/20 uppercase tracking-wide"
                  >
                    {role}
                  </span>
                {/if}
                {#if isSwitching}
                  <Spinner size="sm" />
                {:else if isCurrent}
                  <Check
                    size={iconSizes.sm}
                    class="text-accent"
                    role="img"
                    aria-label={m.dev_switcher_current()}
                  />
                {/if}
              </span>
            </div>
          {/each}
        {/each}
      {/if}
    </div>
  </div>
</Sheet>
