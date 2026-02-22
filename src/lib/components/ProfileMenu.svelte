<script lang="ts">
  import { userState, logout, getUserInitials } from '$lib/state/user.svelte';
  import { locale } from '$lib/state/locale.svelte';
  import * as m from '$lib/paraglide/messages';
  import { LogOut, Settings, Globe } from 'lucide-svelte';

  let open = $state(false);

  function handleKeydown(e: KeyboardEvent) {
    if (open && e.key === 'Escape') open = false;
  }

  const initials = $derived(
    userState.user ? getUserInitials(userState.user) : '?'
  );
  const displayName = $derived(userState.user?.displayName ?? userState.user?.email ?? '');
  const email = $derived(userState.user?.email ?? '');
  const role = $derived(userState.role ?? '');
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="relative">
  <button
    onclick={() => (open = !open)}
    class="w-7 h-7 rounded-full bg-accent/20 border border-accent/30 text-accent text-[11px] font-bold flex items-center justify-center hover:bg-accent/30 transition-colors duration-150 select-none"
    aria-label="Profile menu"
    aria-expanded={open}
    aria-haspopup="menu"
  >
    {initials}
  </button>

  {#if open}
    <button
      class="fixed inset-0 z-40 cursor-default"
      onclick={() => (open = false)}
      aria-label="Close menu"
      tabindex="-1"
    ></button>

    <div id="profile-dropdown" role="menu" class="absolute right-0 top-full mt-1.5 z-50 w-56 bg-bg2 border border-border rounded-lg shadow-lg overflow-hidden">
      <div class="px-3.5 py-3 border-b border-border">
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
      </div>

      <div class="py-1">
        <a
          href="/settings"
          onclick={() => (open = false)}
          class="flex items-center gap-2.5 px-3.5 py-2 text-sm text-muted hover:text-foreground hover:bg-bg3 transition-colors duration-100 no-underline"
        >
          <Settings size={14} />
          Profile settings
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
          Log out
        </button>
      </div>
    </div>
  {/if}
</div>
