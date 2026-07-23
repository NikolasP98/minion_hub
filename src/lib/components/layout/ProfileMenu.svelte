<script lang="ts">
  import { isAdmin, userState, logout } from '$lib/state/features/user.svelte';
  import { hostsState, selectChannel } from '$lib/state/features/hosts.svelte';
  import { wsConnect, wsDisconnect } from '$lib/services/gateway.svelte';
  import { locale } from '$lib/state/ui/locale.svelte';
  import * as m from '$lib/paraglide/messages';
  import { LogOut, Globe, GitBranch, User } from 'lucide-svelte';
  import UserAvatar from '$lib/components/users/UserAvatar.svelte';
  import { Dropdown } from '$lib/components/ui';
  import type { DropdownItem } from '$lib/components/ui';

  const displayName = $derived(userState.user?.displayName ?? userState.user?.email ?? '');
  const email = $derived(userState.user?.email ?? '');
  const avatarUrl = $derived(userState.user?.avatarUrl ?? null);
  const role = $derived(userState.role ?? '');
  const channels = $derived(hostsState.channels);
  const activeChannel = $derived(hostsState.activeChannel ?? channels[0]?.channel ?? null);
  const showBuildChannel = $derived(isAdmin.value && channels.length > 0);

  // Account header + account link + preference toggles + logout. Language and
  // build channel stay open so their live badges update in place. Gateway
  // plumbing is admin-only; regular users follow the org assignment.
  const items = $derived<DropdownItem[]>([
    { value: 'header', label: displayName, href: '/account' },
    { value: 'account', label: m.nav_account(), icon: User, href: '/account' },
    { value: 'language', label: m.settings_language(), icon: Globe, closeOnSelect: false },
    ...(showBuildChannel
      ? [
          {
            value: 'build-channel',
            label: m.hosts_buildChannel(),
            icon: GitBranch,
            closeOnSelect: false,
            disabled: channels.length < 2,
          },
        ]
      : []),
    { value: 'logout', label: m.profile_logout(), icon: LogOut, danger: true },
  ]);

  function onSelect(value: string) {
    if (value === 'language') locale.toggle();
    else if (value === 'build-channel') switchBuildChannel();
    else if (value === 'logout') logout();
    // 'header' / 'account' navigate via their href.
  }

  function switchBuildChannel() {
    if (channels.length < 2) return;
    const currentIndex = channels.findIndex((channel) => channel.channel === activeChannel);
    const next = channels[(currentIndex + 1) % channels.length];
    if (!next || !selectChannel(next.channel)) return;
    wsDisconnect();
    void wsConnect();
  }
</script>

<Dropdown {items} {onSelect} placement="bottom" class="w-56 right-0">
  {#snippet trigger()}
    <span
      class="flex items-center justify-center rounded-full hover:opacity-90 transition-opacity duration-[var(--duration-fast)] leading-none"
      aria-label="Profile menu"
    >
      <UserAvatar name={displayName} {email} src={avatarUrl} size={28} />
    </span>
  {/snippet}

  {#snippet item({ item: it })}
    {#if it.value === 'header'}
      <span class="flex items-center justify-between gap-2 w-full">
        <span class="min-w-0">
          <span class="block text-sm font-semibold text-foreground truncate">{displayName}</span>
          <span class="block text-[length:var(--font-size-label)] text-muted truncate">{email}</span
          >
        </span>
        {#if role}
          <span
            class="shrink-0 text-[length:var(--font-size-telemetry)] font-medium px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/20 uppercase tracking-wide"
          >
            {role}
          </span>
        {/if}
      </span>
    {:else if it.value === 'language' || it.value === 'build-channel'}
      {@const Icon = it.icon}
      <Icon size={14} class="text-muted-foreground" />
      <span class="flex-1">{it.label}</span>
      <span
        class="text-[length:var(--font-size-telemetry)] font-mono font-medium px-1.5 py-0.5 rounded bg-bg3 border border-border"
      >
        {it.value === 'language' ? locale.current.toUpperCase() : activeChannel?.toUpperCase()}
      </span>
    {:else}
      {@const Icon = it.icon}
      {#if Icon}<Icon
          size={14}
          class={it.danger ? 'text-destructive' : 'text-muted-foreground'}
        />{/if}
      <span class="flex-1">{it.label}</span>
    {/if}
  {/snippet}
</Dropdown>
