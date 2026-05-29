<script lang="ts">
    import HostDropdown from "./HostDropdown.svelte";
    import { getActiveHost } from "$lib/state/features/hosts.svelte";
    import { ui } from "$lib/state/ui/ui.svelte";
    import * as m from "$lib/paraglide/messages";

    const activeHost = $derived(getActiveHost());

    function handlePillClick(e: MouseEvent) {
        e.stopPropagation();
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

<button
    type="button"
    class="relative w-full flex items-center gap-1.5 h-6 px-1.5 rounded-[var(--radius-sm)] text-[12px] font-medium cursor-pointer transition-colors whitespace-nowrap select-none {!activeHost
        ? 'text-accent hover:bg-white/[0.05]'
        : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.04]'}"
    onclick={handlePillClick}
>
    {#if activeHost}
        <span
            class="w-1.5 h-1.5 rounded-full shrink-0 bg-success shadow-[0_0_4px_var(--color-success)]"
        ></span>
        <span class="flex-1 overflow-hidden text-ellipsis text-left">{activeHost.name}</span>
        <span class="opacity-40 text-[9px] shrink-0">▾</span>
    {:else}
        {m.hosts_addHost()}
    {/if}

    {#if ui.dropdownOpen && activeHost}
        <HostDropdown />
    {/if}
</button>
