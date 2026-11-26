<script lang="ts">
  import { tick } from 'svelte';
  import { Button } from '@minion-stack/ui';
  // Direct file, not the barrel: the accessibility fixture builds this component without SvelteKit.
  import Dropdown, { type DropdownItem } from '$lib/components/ui/Dropdown.svelte';
  import { iconSizes } from '$lib/components/ui/icon-sizes';
  import { Ellipsis } from 'lucide-svelte';
  import { announce } from '$lib/a11y/announce';
  import * as m from '$lib/paraglide/messages';

  /**
   * The canvas, as a list: everything the pointer can do to an agent or an element on the
   * canvas (select, give a task, move, link, open, remove) is here for the keyboard and for
   * screen readers. The canvas items themselves have no DOM.
   */
  type Kind = 'agent' | 'element';
  type Entry = { id: string; name: string };

  let {
    agents,
    elements = [],
    movable = true,
    selectedId,
    connected,
    onselect,
    onassign,
    onmovestart,
    onmoveby,
    onmoveend,
    onlink,
    onopen,
    onremove,
  }: {
    agents: readonly Entry[];
    elements?: readonly Entry[];
    /** Move and link exist in the free-placement views only (not the pixel office). */
    movable?: boolean;
    selectedId: string | null;
    connected: boolean;
    onselect: (id: string) => void;
    onassign: (id: string) => void;
    onmovestart?: (kind: Kind, id: string) => void;
    onmoveby?: (dx: number, dy: number) => void;
    onmoveend?: (commit: boolean) => void;
    onlink?: (fromId: string, toId: string) => void;
    onopen?: (id: string) => void;
    onremove?: (kind: Kind, id: string) => void;
  } = $props();

  const STEP = 16;
  let moving = $state<{ kind: Kind; id: string; name: string } | null>(null);
  let moveSlot = $state<HTMLElement | null>(null);

  function agentItems(agent: Entry): DropdownItem[] {
    const others = agents.filter((other) => other.id !== agent.id);
    return [
      ...(movable ? [{ value: 'move', label: m.workshop_kbMove() }] : []),
      ...(movable
        ? others.map((other) => ({
            value: `link:${other.id}`,
            label: m.workshop_kbLinkTo({ name: other.name }),
          }))
        : []),
      { value: 'remove', label: m.workshop_removeFromCanvas(), danger: true },
    ];
  }
  const elementItems = (): DropdownItem[] => [
    ...(movable ? [{ value: 'move', label: m.workshop_kbMove() }] : []),
    { value: 'remove', label: m.workshop_removeFromCanvas(), danger: true },
  ];

  async function pick(kind: Kind, entry: Entry, value: string) {
    if (value === 'remove') {
      onremove?.(kind, entry.id);
      announce(m.workshop_kbRemoved({ name: entry.name }));
    } else if (value.startsWith('link:')) onlink?.(entry.id, value.slice(5));
    else if (value === 'move') {
      moving = { kind, id: entry.id, name: entry.name };
      onmovestart?.(kind, entry.id);
      announce(m.workshop_kbMoving({ name: entry.name }));
      await tick();
      // The closing menu hands focus back to its trigger, which this row just replaced:
      // take it now and again once the menu has let go.
      focusMove();
      setTimeout(focusMove, 80);
    }
  }
  const focusMove = () => moveSlot?.querySelector<HTMLElement>('button')?.focus();
  /** Focus that has really left the move control (Tab, a click elsewhere) drops the item. */
  function leftMove() {
    setTimeout(() => {
      if (moving && !moveSlot?.contains(document.activeElement)) endMove(true);
    }, 160);
  }
  function endMove(commit: boolean) {
    const done = moving;
    if (!done) return;
    moving = null;
    onmoveend?.(commit);
    announce(
      commit
        ? m.workshop_kbMoved({ name: done.name })
        : m.workshop_kbMoveCancelled({ name: done.name }),
    );
  }
  function moveKeys(e: KeyboardEvent) {
    const step = e.shiftKey ? STEP * 4 : STEP;
    const by: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (by[e.key]) onmoveby?.(...by[e.key]);
    else if (e.key === 'Enter' || e.key === ' ') endMove(true);
    else if (e.key === 'Escape') {
      e.stopPropagation(); // the canvas's own Escape would also drop the selection
      endMove(false);
    } else return;
    e.preventDefault();
  }
</script>

{#snippet rowMenu(kind: Kind, entry: Entry, items: DropdownItem[])}
  {@const isMoving = moving?.id === entry.id}
  {#if isMoving}
    <!-- Focus leaving (Tab, a click elsewhere) drops the item where it is. -->
    <span bind:this={moveSlot}>
      <Button variant="secondary" aria-pressed="true" onkeydown={moveKeys} onblur={leftMove}
        >{m.workshop_kbMovingHint()}</Button
      >
    </span>
  {/if}
  <!-- The menu stays mounted while its item moves: it is closing as the move starts. -->
  <span hidden={isMoving}>
    <Dropdown {items} onSelect={(value) => void pick(kind, entry, value)}>
      {#snippet trigger()}
        <span class="more"
          ><Ellipsis size={iconSizes.sm} aria-hidden="true" /><span class="sr-only"
            >{m.workshop_kbMoreActions({ name: entry.name })}</span
          ></span
        >
      {/snippet}
    </Dropdown>
  </span>
{/snippet}

{#if agents.length > 0 || elements.length > 0}
  <details class="agent-controls">
    <summary class="t-label">{m.nav_agents()} ({agents.length})</summary>
    {#if agents.length > 0}
      <ul aria-label={m.nav_agents()}>
        {#each agents as agent (agent.id)}
          <li>
            <Button
              variant="ghost"
              aria-pressed={selectedId === agent.id}
              onclick={() => onselect(agent.id)}>{agent.name}</Button
            >
            <Button
              variant="ghost"
              disabled={!connected}
              aria-label={`${m.workshop_assignTask()}: ${agent.name}`}
              onclick={() => onassign(agent.id)}>{m.workshop_assignTask()}</Button
            >
            {@render rowMenu('agent', agent, agentItems(agent))}
          </li>
        {/each}
      </ul>
    {/if}
    {#if elements.length > 0}
      <p class="t-label section">{m.workshop_kbElements()} ({elements.length})</p>
      <ul aria-label={m.workshop_kbElements()}>
        {#each elements as element (element.id)}
          <li>
            <Button
              variant="ghost"
              aria-label={`${m.workshop_open()}: ${element.name}`}
              onclick={() => onopen?.(element.id)}>{element.name}</Button
            >
            {@render rowMenu('element', element, elementItems())}
          </li>
        {/each}
      </ul>
    {/if}
  </details>
{/if}

<style>
  .agent-controls {
    position: absolute;
    top: var(--space-8);
    right: var(--space-2);
    z-index: var(--layer-dropdown);
    max-width: calc(100% - var(--space-4));
    max-height: calc(100% - var(--space-12));
    overflow: auto;
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    border: var(--hairline) solid var(--color-border);
    border-radius: var(--radius-md);
  }
  summary {
    min-height: var(--control-height-touch);
    display: list-item;
    align-content: center;
    padding: var(--space-2) var(--space-3);
    cursor: pointer;
  }
  .section {
    margin: 0;
    padding: var(--space-2) var(--space-3) 0;
  }
  ul {
    margin: 0;
    padding: var(--space-2);
    list-style: none;
  }
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-control-gap);
  }
  .more {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--control-height-touch);
  }
  .agent-controls :global(button) {
    min-height: var(--control-height-touch);
    max-width: 100%;
  }
  .agent-controls :global(button > span) {
    white-space: normal;
    overflow-wrap: anywhere;
  }
</style>
