<script lang="ts">
  import HostDropdown from './HostDropdown.svelte';
  import HostsOverlay from './HostsOverlay.svelte';
  import { getActiveHost } from '$lib/state/hosts.svelte';
  import { ui } from '$lib/state/ui.svelte';

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

<svelte:document onclick={() => { ui.dropdownOpen = false; }} />

<div
  class="relative bg-bg3 border border-border rounded-md text-foreground py-[5px] px-3 text-[13px] font-semibold cursor-pointer flex items-center gap-[7px] transition-colors whitespace-nowrap select-none hover:border-accent {!activeHost ? 'border-accent text-accent' : ''}"
  role="button"
  tabindex="0"
  onclick={handlePillClick}
  onkeydown={(e) => e.key === 'Enter' && handlePillClick(e as unknown as MouseEvent)}
>
  {#if activeHost}
    <span class="w-[7px] h-[7px] rounded-full shrink-0 bg-success shadow-[0_0_5px_var(--color-success)]"></span>
    {activeHost.name}
    <span class="opacity-50 text-[10px]">▾</span>
  {:else}
    Add host +
  {/if}

  {#if ui.dropdownOpen && activeHost}
    <HostDropdown />
  {/if}
</div>

{#if ui.overlayOpen}
  <HostsOverlay />
{/if}
