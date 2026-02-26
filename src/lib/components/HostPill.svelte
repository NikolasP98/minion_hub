<script lang="ts">
    import HostDropdown from "./HostDropdown.svelte";
    import { getActiveHost } from "$lib/state/hosts.svelte";
    import { ui } from "$lib/state/ui.svelte";
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
    class="relative bg-bg3 border border-border rounded-md text-foreground py-1.25 px-3 text-[13px] font-semibold cursor-pointer flex items-center gap-1.75 transition-colors whitespace-nowrap select-none hover:border-accent {!activeHost
        ? 'border-accent text-accent'
        : ''}"
    onclick={handlePillClick}
>
    {#if activeHost}
        <span
            class="w-1.75 h-1.75 rounded-full shrink-0 bg-success shadow-[0_0_5px_var(--color-success)]"
        ></span>
        {activeHost.name}
        <span class="opacity-50 text-[10px]">▾</span>
    {:else}
        {m.hosts_addHost()}
    {/if}

    {#if ui.dropdownOpen && activeHost}
        <HostDropdown />
    {/if}
</button>
