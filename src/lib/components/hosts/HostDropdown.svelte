<script lang="ts">
  import { Button } from '$lib/components/ui';
  import { goto } from '$lib/navigation';
  import { hostsState } from '$lib/state/features/hosts.svelte';
  import { ui } from '$lib/state/ui/ui.svelte';
  import { wsConnect, wsDisconnect } from '$lib/services/gateway.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { fmtTimeAgo } from '$lib/utils/format';
  import * as m from '$lib/paraglide/messages';
  import type { DropdownItem } from '$lib/components/ui';
  import { page } from '$app/state';
  import { hostLabel } from './host-label';
  import { scopeHostsToOrg } from './host-scope';

  let { align = 'left' }: { align?: 'left' | 'right' } = $props();

  // Host rows + a separator + the trailing "Manage" action, expressed in the
  // shared DropdownItem vocabulary. Visibility/open-state stays owned by the
  // parent (HostPill toggles `ui.dropdownOpen` and closes on document click),
  // so this renders the menu panel directly rather than wiring the Zag-trigger
  // `<Dropdown>` machine (which would need to own the trigger button too).
  /** Gateways are assigned per org, and two orgs can be leased instances that
   *  share a name AND a URL (e.g. two `protopi-dev`). Labelling by name alone
   *  makes them indistinguishable — and picking the wrong one provisions a
   *  channel into another org. Qualify with the org name, but only for the
   *  names that actually collide, so the common case stays clean. */
  const activeOrgId = $derived((page.data as { activeOrgId?: string | null })?.activeOrgId ?? null);

  const orgNameById = $derived.by(() => {
    const orgs = (page.data as { organizations?: { id: string; name: string }[] })?.organizations ?? [];
    return new Map(orgs.map((o) => [o.id, o.name]));
  });

  /** Only the acting org's gateways (plus shared-pool ones, plus whatever is
   *  currently active). Scoping is what actually removes the ambiguity — the
   *  org-qualified label below is the safety net for whatever still collides. */
  const visibleHosts = $derived(
    scopeHostsToOrg(hostsState.hosts, activeOrgId, hostsState.activeHostId),
  );

  const items = $derived<DropdownItem[]>([
    ...visibleHosts.map((h) => ({ value: h.id, label: hostLabel(h, visibleHosts, orgNameById) })),
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
  class="absolute top-[calc(100%+4px)] {align === 'right'
    ? 'right-0'
    : 'left-0'} z-[var(--layer-modal)] surface-3 rounded-[var(--radius-md)] min-w-[200px] max-w-[320px] overflow-hidden p-1"
  role="menu"
  tabindex="0"
  onclick={(e) => e.stopPropagation()}
  onkeydown={(e) => e.stopPropagation()}
>
  {#each items as it (it.value)}
    {#if it.divider}
      <div class="my-1 h-px bg-[var(--hairline)]" role="separator"></div>
    {:else if it.value === '__manage'}
      <Button
        variant="ghost"
        type="button"
        class="flex w-full items-center px-2.5 py-1.5 rounded-[var(--radius-sm)] text-xs text-muted-foreground bg-transparent border-none cursor-pointer text-left transition-colors hover:bg-foreground/[0.06] hover:text-muted"
        role="menuitem"
        onclick={() => onSelect(it.value)}
        onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && onSelect(it.value)}
      >
        {it.label}
      </Button>
    {:else}
      {@const host = visibleHosts.find((h) => h.id === it.value)!}
      <Button
        variant="ghost"
        type="button"
        class="flex w-full items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius-sm)] text-[length:var(--font-size-body)] text-foreground bg-transparent border-none cursor-pointer text-left transition-colors hover:bg-foreground/[0.06]"
        role="menuitem"
        onclick={() => onSelect(it.value)}
        onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && onSelect(it.value)}
      >
        <span
          class="w-[7px] h-[7px] rounded-full shrink-0 {host.id === hostsState.activeHostId &&
          conn.connected
            ? 'bg-success shadow-[var(--shadow-status-glow)]'
            : 'bg-muted-foreground'}"
        ></span>
        <!-- it.label, NOT host.name: the label is org-qualified when two gateways
             share a name, and picking the wrong one provisions into another org. -->
        <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{it.label}</span>
        <span class="text-[length:var(--font-size-telemetry)] text-muted-foreground shrink-0"
          >{fmtTimeAgo(host.lastConnectedAt)}</span
        >
      </Button>
    {/if}
  {/each}
</div>
