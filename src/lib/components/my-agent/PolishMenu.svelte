<script lang="ts">
  import { Button } from '$lib/components/ui';

  import * as m from '$lib/paraglide/messages';
  import { Users, AlignLeft, AlignJustify, Briefcase, ListChecks, Wand2 } from 'lucide-svelte';
  import {
    NOTE_POLISH_INTENTS,
    type NotePolishIntent,
  } from '$lib/state/features/notes-autocomplete';

  let { onpick, onclose }: { onpick: (i: NotePolishIntent) => void; onclose: () => void } =
    $props();

  const ICONS: Record<NotePolishIntent, typeof Users> = {
    meeting: Users,
    short: AlignLeft,
    long: AlignJustify,
    formal: Briefcase,
    actions: ListChecks,
  };
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="pm"
  role="menu"
  tabindex="-1"
  onmousedown={(e) => e.stopPropagation()}
  aria-label={m.polishMenu_polishOptions()}
>
  <div class="pm-head"><Wand2 size={13} /> {m.polishMenu_polishAs()}</div>
  {#each NOTE_POLISH_INTENTS as it (it.id)}
    {@const Icon = ICONS[it.id]}
    <Button
      type="button"
      role="menuitem"
      class="pm-item"
      onclick={() => {
        onpick(it.id);
        onclose();
      }}
    >
      <Icon size={14} />
      {it.label}
    </Button>
  {/each}
</div>

<style>
  .pm {
    min-width: 168px;
    display: flex;
    flex-direction: column;
    padding: var(--space-1);
    border-radius: var(--radius-xl);
    background: var(--color-bg2);
    border: 1px solid color-mix(in srgb, var(--color-foreground) 12%, transparent);
    box-shadow: var(--shadow-elevation-2);
  }
  .pm-head {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2) var(--space-2);
    font-size: var(--font-size-caption);
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
  }
  .pm-head :global(svg) {
    color: color-mix(in srgb, var(--color-purple) 90%, transparent);
  }
  :global(.pm-item) {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-2);
    font-size: var(--font-size-caption);
    font-family: inherit;
    text-align: left;
    border-radius: var(--radius-md);
    cursor: pointer;
    background: transparent;
    border: none;
    color: color-mix(in srgb, var(--color-foreground) 84%, transparent);
    transition:
      background var(--duration-fast) ease,
      color var(--duration-fast) ease;
  }
  :global(.pm-item):hover {
    color: var(--color-foreground);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }
  :global(.pm-item) :global(svg) {
    color: var(--color-accent);
    flex-shrink: 0;
  }
</style>
