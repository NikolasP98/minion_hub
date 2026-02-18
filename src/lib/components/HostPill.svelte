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
  class="host-pill {!activeHost ? 'add-host' : ''}"
  role="button"
  tabindex="0"
  onclick={handlePillClick}
  onkeydown={(e) => e.key === 'Enter' && handlePillClick(e as unknown as MouseEvent)}
>
  {#if activeHost}
    <span class="pill-dot active"></span>
    {activeHost.name}
    <span class="pill-chevron">▾</span>
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

<style>
  .host-pill {
    position: relative;
    background: var(--bg3);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    padding: 5px 12px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 7px;
    transition: border-color 0.2s;
    white-space: nowrap;
    user-select: none;
  }
  .host-pill:hover { border-color: var(--accent); }
  .host-pill.add-host { border-color: var(--accent); color: var(--accent); }
  .pill-dot {
    width: 7px; height: 7px;
    border-radius: 50%; flex-shrink: 0;
    background: var(--text3);
  }
  .pill-dot.active { background: var(--green); box-shadow: 0 0 5px var(--green); }
  .pill-chevron { opacity: 0.5; font-size: 10px; }
</style>
