<script lang="ts">
    import HostDropdown from "./HostDropdown.svelte";
    import Tooltip from "$lib/components/layout/Tooltip.svelte";
    import { getActiveHost } from "$lib/state/features/hosts.svelte";
    import { ui } from "$lib/state/ui/ui.svelte";
    import { conn } from "$lib/state/gateway/connection.svelte";
    import { gw } from "$lib/state/gateway/gateway-data.svelte";
    import { isAdmin } from "$lib/state/features/user.svelte";
    import { fmtTimeAgo, fmtUptime } from "$lib/utils/format";
    import * as m from "$lib/paraglide/messages";

    // `align` controls which edge the switcher dropdown anchors to — the notch
    // lives at the top-right so it opens right-aligned; the mobile topbar is
    // left-aligned. `tooltipPlacement` follows suit.
    let { align = "left" }: { align?: "left" | "right" } = $props();

    const activeHost = $derived(getActiveHost());
    const connected = $derived(conn.connected);
    // Only admins may switch gateways. Everyone else gets a read-only status
    // pill with a hover tooltip for the connection details.
    const canSwitch = $derived(isAdmin.value);

    // Server uptime (relocated from the agents-sidebar footer) — surfaced on
    // hover for everyone, admins included.
    const uptimeMs = $derived(
        gw.hello && conn.connectedAt
            ? (gw.hello.snapshot?.uptimeMs ?? 0) + (Date.now() - conn.connectedAt)
            : null,
    );

    // One-line connection summary shown on hover: name · status · uptime.
    const detail = $derived(
        activeHost
            ? `${activeHost.name} · ${connected ? "Connected" : "Disconnected"}${
                  connected && uptimeMs != null ? ` · up ${fmtUptime(uptimeMs)}` : ""
              }${
                  !connected && activeHost.lastConnectedAt
                      ? ` · last seen ${fmtTimeAgo(activeHost.lastConnectedAt)}`
                      : ""
              }`
            : "No server connected",
    );

    function handlePillClick(e: MouseEvent) {
        e.stopPropagation();
        if (!canSwitch) return;
        if (!activeHost) {
            ui.overlayOpen = true;
        } else {
            ui.dropdownOpen = !ui.dropdownOpen;
        }
    }
</script>

<svelte:document
    onclick={() => {
        ui.dropdownOpen = false;
    }}
/>

<Tooltip
    label={detail}
    id="server-status-tip"
    placement={align === "right" ? "left" : "bottom"}
    openDelay={250}
>
    {#snippet children(trigger)}
        <button
            type="button"
            {...trigger}
            class="relative flex items-center gap-1.5 h-6 px-1.5 max-w-[160px] rounded-[var(--radius-sm)] text-[12px] font-medium transition-colors whitespace-nowrap select-none {canSwitch
                ? 'cursor-pointer'
                : 'cursor-default'} {!activeHost
                ? 'text-accent'
                : 'text-muted-foreground'} {canSwitch
                ? !activeHost
                    ? 'hover:bg-white/[0.05]'
                    : 'hover:text-foreground hover:bg-white/[0.04]'
                : ''}"
            onclick={handlePillClick}
            aria-label={detail}
            aria-haspopup={canSwitch && activeHost ? "menu" : undefined}
        >
            {#if activeHost}
                <span
                    class="w-1.5 h-1.5 rounded-full shrink-0 transition-colors {connected
                        ? 'bg-success shadow-[0_0_4px_var(--color-success)]'
                        : 'bg-warning shadow-[0_0_4px_var(--color-warning)] animate-pulse'}"
                ></span>
                <span class="flex-1 overflow-hidden text-ellipsis text-left">{activeHost.name}</span>
                {#if canSwitch}
                    <span class="opacity-40 text-[9px] shrink-0">▾</span>
                {/if}
            {:else}
                <span
                    class="w-1.5 h-1.5 rounded-full shrink-0 bg-warning shadow-[0_0_4px_var(--color-warning)] animate-pulse"
                ></span>
                <span>{canSwitch ? m.hosts_addHost() : "No server"}</span>
            {/if}

            {#if ui.dropdownOpen && activeHost && canSwitch}
                <HostDropdown {align} />
            {/if}
        </button>
    {/snippet}
</Tooltip>
