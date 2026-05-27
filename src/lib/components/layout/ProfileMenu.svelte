<script lang="ts">
  import { userState, logout } from '$lib/state/features/user.svelte';
  import { locale } from '$lib/state/ui/locale.svelte';
  import * as m from '$lib/paraglide/messages';
  import { LogOut, Globe, User } from 'lucide-svelte';
  import UserAvatar from '$lib/components/users/UserAvatar.svelte';

  let open = $state(false);

  function handleKeydown(e: KeyboardEvent) {
    if (open && e.key === 'Escape') open = false;
  }

  const displayName = $derived(userState.user?.displayName ?? userState.user?.email ?? '');
  const email = $derived(userState.user?.email ?? '');
  const avatarUrl = $derived(userState.user?.avatarUrl ?? null);
  const role = $derived(userState.role ?? '');
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="relative">
  <button
    onclick={() => (open = !open)}
    class="rounded-full p-0 border-none bg-transparent cursor-pointer hover:opacity-90 transition-opacity duration-150"
    aria-label="Profile menu"
    aria-expanded={open}
    aria-haspopup="menu"
  >
    <UserAvatar name={displayName} {email} src={avatarUrl} size={28} />
  </button>

  {#if open}
    <button
      class="fixed inset-0 z-40 cursor-default"
      onclick={() => (open = false)}
      aria-label="Close menu"
      tabindex="-1"
    ></button>

    <div id="profile-dropdown" role="menu" class="absolute right-0 top-full mt-1.5 z-50 w-56 bg-bg2 border border-border rounded-lg shadow-lg overflow-hidden">
      <a
        href="/account"
        role="menuitem"
        onclick={() => (open = false)}
        class="block px-3.5 py-3 border-b border-border no-underline hover:bg-bg3 transition-colors duration-100"
      >
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <p class="text-sm font-semibold text-foreground truncate">{displayName}</p>
            <p class="text-[11px] text-muted truncate">{email}</p>
          </div>
          {#if role}
            <span class="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/20 uppercase tracking-wide">
              {role}
            </span>
          {/if}
        </div>
      </a>

      <div class="py-1">
        <a
          href="/account"
          role="menuitem"
          onclick={() => (open = false)}
          class="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-muted hover:text-foreground hover:bg-bg3 transition-colors duration-100 no-underline"
        >
          <User size={14} />
          <span class="flex-1 text-left">{m.nav_account()}</span>
        </a>
        <button
          onclick={locale.toggle}
          class="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-muted hover:text-foreground hover:bg-bg3 transition-colors duration-100"
        >
          <Globe size={14} />
          <span class="flex-1 text-left">{m.settings_language()}</span>
          <span class="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-bg3 border border-border">{locale.current.toUpperCase()}</span>
        </button>
        <button
          onclick={logout}
          class="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-muted hover:text-red-400 hover:bg-bg3 transition-colors duration-100"
        >
          <LogOut size={14} />
          {m.profile_logout()}
        </button>
      </div>
    </div>
  {/if}
</div>
