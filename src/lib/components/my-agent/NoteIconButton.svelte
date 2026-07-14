<script lang="ts">
  import { Button } from '$lib/components/ui';

  import * as m from '$lib/paraglide/messages';
  import { StickyNote } from 'lucide-svelte';
  import IconPicker from './IconPicker.svelte';
  import { iconComp } from './note-icons';

  let {
    icon = '',
    onpick,
    size = 16,
  }: { icon?: string; onpick: (value: string) => void; size?: number } = $props();

  let open = $state(false);

  const LucideComp = $derived(icon.startsWith('lucide:') ? iconComp(icon.slice(7)) : null);
  const isEmoji = $derived(!!icon && !icon.startsWith('lucide:'));

  function choose(value: string) {
    onpick(value);
  }
</script>

<div class="ni-wrap">
  <Button
    type="button"
    class="ni-btn"
    title={m.noteIconButton_chooseIcon()}
    aria-label={m.noteIconButton_chooseIcon()}
    aria-haspopup="dialog"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    {#if isEmoji}
      <span class="ni-emoji" style:font-size="{size}px">{icon}</span>
    {:else if LucideComp}
      <LucideComp {size} />
    {:else}
      <StickyNote {size} />
    {/if}
  </Button>
  {#if open}
    <div class="ni-pop">
      <IconPicker current={icon} onpick={choose} onclose={() => (open = false)} />
    </div>
  {/if}
</div>

<svelte:window
  onpointerdown={(e) => {
    if (open && e.target instanceof Element && !e.target.closest('.ni-wrap')) open = false;
  }}
  onkeydown={(e) => {
    if (e.key === 'Escape' && open) open = false;
  }}
/>

<style>
  .ni-wrap {
    position: relative;
    display: inline-flex;
  }
  :global(.ni-btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-1);
    border-radius: var(--radius-lg);
    cursor: pointer;
    background: transparent;
    border: none;
    color: var(--color-accent);
    transition: background var(--duration-fast) ease;
  }
  :global(.ni-btn):hover {
    background: color-mix(in srgb, var(--color-foreground) 8%, transparent);
  }
  .ni-emoji {
    line-height: 1;
  }
  .ni-pop {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: var(--layer-debug);
  }
</style>
