<script lang="ts">
  import { userState, logout } from '$lib/state/features/user.svelte';
  import { locale } from '$lib/state/ui/locale.svelte';
  import * as m from '$lib/paraglide/messages';
  import { LogOut, Globe, User } from 'lucide-svelte';
  import UserAvatar from '$lib/components/users/UserAvatar.svelte';
  import { Dropdown } from '$lib/components/ui';
  import type { DropdownItem } from '$lib/components/ui';

  const displayName = $derived(userState.user?.displayName ?? userState.user?.email ?? '');
  const email = $derived(userState.user?.email ?? '');
  const avatarUrl = $derived(userState.user?.avatarUrl ?? null);
  const role = $derived(userState.role ?? '');

  // Account header + account link + language toggle + logout. The language
  // toggle keeps the menu open (`closeOnSelect: false`) and renders a live
  // locale badge via the custom item snippet below; account rows use `href`.
  const items = $derived<DropdownItem[]>([
    { value: 'header', label: displayName, href: '/account' },
    { value: 'account', label: m.nav_account(), icon: User, href: '/account' },
    { value: 'language', label: m.settings_language(), icon: Globe, closeOnSelect: false },
    { value: 'logout', label: m.profile_logout(), icon: LogOut, danger: true },
  ]);

  function onSelect(value: string) {
    if (value === 'language') locale.toggle();
    else if (value === 'logout') logout();
    // 'header' / 'account' navigate via their href.
  }
</script>

<Dropdown {items} {onSelect} placement="bottom" class="w-56 right-0">
  {#snippet trigger()}
    <span
      class="flex items-center justify-center rounded-full hover:opacity-90 transition-opacity duration-150 leading-none"
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
          <span class="block text-[11px] text-muted truncate">{email}</span>
        </span>
        {#if role}
          <span
            class="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/20 uppercase tracking-wide"
          >
            {role}
          </span>
        {/if}
      </span>
    {:else if it.value === 'language'}
      {@const Icon = it.icon}
      <Icon size={14} class="text-muted-foreground" />
      <span class="flex-1">{it.label}</span>
      <span class="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-bg3 border border-border">
        {locale.current.toUpperCase()}
      </span>
    {:else}
      {@const Icon = it.icon}
      {#if Icon}<Icon size={14} class={it.danger ? 'text-destructive' : 'text-muted-foreground'} />{/if}
      <span class="flex-1">{it.label}</span>
    {/if}
  {/snippet}
</Dropdown>
