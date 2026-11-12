<script lang="ts">
  import type { RoleSimulationState } from '$lib/role-simulation';
  import * as m from '$lib/paraglide/messages';
  let { state: simulation }: { state: RoleSimulationState } = $props();
  let frame = $state<HTMLDivElement>();

  // Native dialogs paint in the browser's top layer, above every z-index.
  // A manual popover keeps the perimeter there too; lift it again whenever
  // another dialog/popover opens, without moving focus or taking input.
  $effect(() => {
    if (!simulation.active || !frame) return;
    const element = frame;
    if (typeof element.showPopover !== 'function') return;
    element.setAttribute('popover', 'manual');
    let live = true;
    const lift = () => {
      if (!live || !element.isConnected) return;
      if (element.matches(':popover-open')) element.hidePopover();
      element.showPopover();
    };
    const observer = new MutationObserver((records) => {
      if (
        records.some((record) => record.target instanceof HTMLDialogElement && record.target.open)
      )
        lift();
    });
    const onToggle = (event: Event) => {
      if (event.target === element || !(event.target instanceof HTMLElement)) return;
      if (event.target instanceof HTMLDialogElement || event.target.hasAttribute('popover'))
        queueMicrotask(lift);
    };
    observer.observe(document.documentElement, {
      subtree: true,
      attributes: true,
      attributeFilter: ['open'],
    });
    document.addEventListener('toggle', onToggle, true);
    lift();
    return () => {
      live = false;
      observer.disconnect();
      document.removeEventListener('toggle', onToggle, true);
      if (element.matches(':popover-open')) element.hidePopover();
    };
  });
</script>

{#if simulation.active}
  <div
    bind:this={frame}
    class="simulation-frame"
    data-role-simulation-frame
    aria-hidden="true"
  ></div>
  <span role="status" aria-live="polite" class="sr-only">
    {m.roleSimulation_active({ role: simulation.roleName ?? simulation.roleKey ?? '' })}
  </span>
{/if}

<style>
  .simulation-frame {
    position: fixed;
    inset: 0;
    width: auto;
    height: auto;
    margin: 0;
    padding: 0;
    background: transparent;
    z-index: var(--layer-debug);
    border: calc(var(--space-0-5) / 2) solid
      color-mix(in srgb, var(--color-warning-fg) 45%, var(--color-canvas));
    animation: simulation-breathe calc(var(--duration-slow) * 8) var(--ease-standard) infinite;
    pointer-events: none;
    box-sizing: border-box;
  }
  @keyframes simulation-breathe {
    0%,
    100% {
      opacity: 0.65;
    }
    50% {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .simulation-frame {
      animation: none;
      opacity: 1;
    }
  }
  .simulation-frame::backdrop {
    pointer-events: none;
    background: transparent;
  }
</style>
