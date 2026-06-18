<script lang="ts">
  import { goto } from '$app/navigation';
  import { hostsState } from '$lib/state/features/hosts.svelte';
  import { ui } from '$lib/state/ui/ui.svelte';
  import { wsConnect, wsDisconnect } from '$lib/services/gateway.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { fmtTimeAgo } from '$lib/utils/format';
  import * as m from '$lib/paraglide/messages';
  import type { DropdownItem } from '$lib/components/ui';

  let { align = 'left' }: { align?: 'left' | 'right' } = $props();

  // Host rows + a separator + the trailing "Manage" action, expressed in the
  // shared DropdownItem vocabulary. Visibility/open-state stays owned by the
  // parent (HostPill toggles `ui.dropdownOpen` and closes on document click),
  // so this renders the menu panel directly rather than wiring the Zag-trigger
  // `<Dropdown>` machine (which would need to own the trigger button too).
  const items = $derived<DropdownItem[]>([
    ...hostsState.hosts.map((h) => ({ value: h.id, label: h.name })),
    { value: '__sep', label: '', divider: true },
    { value: '__manage', label: m.hosts_manage() },
  ]);

  function onSelect(value: string) {
    if (value === '__manage') {
      ui.dropdownOpen = false;
      goto('/settings/gateways');
      return;
    }
    if (hostsState.activeHostId === value) {
      ui.dropdownOpen = false;
      return;
    }
    wsDisconnect();
    hostsState.activeHostId = value;
    ui.dropdownOpen = false;
    wsConnect();
  }
</script>

<div
  class="absolute top-[calc(100%+4px)] {align === 'right' ? 'right-0' : 'left-0'} z-50 surface-3 rounded-[var(--radius-md)] min-w-[200px] max-w-[320px] overflow-hidden p-1"
  role="menu"
  tabindex="0"
  onclick={(e) => e.stopPropagation()}
  onkeydown={(e) => e.stopPropagation()}
>
  {#each items as it (it.value)}
    {#if it.divider}
      <div class="my-1 h-px bg-[var(--hairline)]" role="separator"></div>
    {:else if it.value === '__manage'}
      <button
        type="button"
        class="flex w-full items-center px-2.5 py-1.5 rounded-[var(--radius-sm)] text-xs text-muted-foreground bg-transparent border-none cursor-pointer text-left transition-colors hover:bg-white/[0.06] hover:text-muted"
        role="menuitem"
        onclick={() => onSelect(it.value)}
        onkeydown={(e) => e.key === 'Enter' && onSelect(it.value)}
      >
        {it.label}
      </button>
    {:else}
      {@const host = hostsState.hosts.find((h) => h.id === it.value)!}
      <button
        type="button"
        class="flex w-full items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius-sm)] text-[13px] text-foreground bg-transparent border-none cursor-pointer text-left transition-colors hover:bg-white/[0.06]"
        role="menuitem"
        onclick={() => onSelect(it.value)}
        onkeydown={(e) => e.key === 'Enter' && onSelect(it.value)}
      >
        <span
          class="w-[7px] h-[7px] rounded-full shrink-0 {host.id === hostsState.activeHostId && conn.connected
            ? 'bg-success shadow-[0_0_5px_var(--color-success)]'
            : 'bg-muted-foreground'}"
        ></span>
        <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{host.name}</span>
        <span class="text-[10px] text-muted-foreground shrink-0">{fmtTimeAgo(host.lastConnectedAt)}</span>
      </button>
    {/if}
  {/each}
</div>
