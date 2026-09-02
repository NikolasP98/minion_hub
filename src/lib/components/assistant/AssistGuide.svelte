<script lang="ts">
  /**
   * Interactive walkthrough driven by the assistant's `ui.guide` tool.
   *
   * Each step spotlights one element (`data-assist` key) with a coach card.
   * The engine is aware of what is on screen:
   *  - a step whose element is not mounted yet WAITS for it (polling), showing
   *    the instruction so the user knows what to do to make it appear;
   *  - if a LATER step's element is already visible while the current one is
   *    not (e.g. the type chooser after the type was picked), it skips forward;
   *  - a step auto-advances once the user interacts with its element (click,
   *    input, change), so the tutorial follows the user's own actions.
   * Back / Next / Done and Escape stay available. Mounted once in (app)/+layout.
   */
  import { Button } from '$lib/components/ui';
  import {
    guide,
    nextGuideStep,
    prevGuideStep,
    endGuide,
    resolveTarget,
  } from '$lib/assistant/guide.svelte';
  import * as m from '$lib/paraglide/messages';

  const step = $derived(guide.active ? guide.steps[guide.index] : null);
  let rect = $state<{ top: number; left: number; width: number; height: number } | null>(null);
  let waiting = $state(false);
  // Hub dialogs are native <dialog>.showModal() (top layer + inert outside), so
  // z-index alone can never paint over them and outside handlers are dead. The
  // overlay is a manual popover (top layer) re-parented into the open dialog.
  let root = $state<HTMLDivElement | null>(null);
  $effect(() => {
    if (!root || !guide.active) return;
    const host = document.querySelector<HTMLDialogElement>('dialog[open]');
    if (host && root.parentElement !== host) host.appendChild(root);
    try {
      root.showPopover();
    } catch {
      /* already open or unsupported — z-index fallback still applies */
    }
  });

  const PAD = 6;

  function measure(el: HTMLElement) {
    const r = el.getBoundingClientRect();
    rect = {
      top: r.top - PAD,
      left: r.left - PAD,
      width: r.width + PAD * 2,
      height: r.height + PAD * 2,
    };
  }

  /** Index of the first step at/after `from` whose element is on screen, or -1. */
  function firstVisibleFrom(from: number): number {
    for (let i = from; i < guide.steps.length; i++) {
      if (resolveTarget(guide.steps[i].target)) return i;
    }
    return -1;
  }

  $effect(() => {
    if (!step) return;
    const idx = guide.index;
    let el: HTMLElement | null = null;
    let advanced = false;
    const stop: Array<() => void> = [];

    const advance = () => {
      if (advanced) return;
      advanced = true;
      // Let the interaction settle (a click that opens a window, a keystroke
      // that fills a field) before moving on.
      setTimeout(() => {
        if (guide.active && guide.index === idx) nextGuideStep();
      }, 700);
    };

    const attach = (target: HTMLElement) => {
      el = target;
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      measure(target);
      waiting = false;
      // Fields advance on input/change, everything else on click. A window or
      // dialog opened by that click is usually what the next step points at.
      const isField =
        /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
        !!target.querySelector('input,textarea,select');
      const evs = isField ? ['change', 'input'] : ['click'];
      for (const ev of evs) {
        const h = () => advance();
        target.addEventListener(ev, h, { capture: true });
        stop.push(() => target.removeEventListener(ev, h, { capture: true }));
      }
    };

    const tick = () => {
      if (!guide.active || guide.index !== idx) return;
      if (el && el.isConnected) {
        measure(el);
        return;
      }
      const here = resolveTarget(step.target);
      if (here) {
        attach(here);
        return;
      }
      // Not on screen. Only at the FIRST step may we skip ahead (e.g. the type
      // chooser is gone because the form opened with the type preset); later
      // steps wait — a submit button is visible all along and must not pull the
      // walkthrough forward past the field the user still has to reach.
      if (idx === 0) {
        const later = firstVisibleFrom(1);
        if (later > 0) {
          guide.index = later;
          return;
        }
      }
      rect = null;
      waiting = true;
    };

    tick();
    const poll = setInterval(tick, 400);
    window.addEventListener('resize', tick);
    window.addEventListener('scroll', tick, true);
    return () => {
      clearInterval(poll);
      window.removeEventListener('resize', tick);
      window.removeEventListener('scroll', tick, true);
      for (const s of stop) s();
    };
  });

  function onKey(e: KeyboardEvent) {
    if (!guide.active) return;
    if (e.key === 'Escape') endGuide();
    else if (e.key === 'ArrowRight') nextGuideStep();
    else if (e.key === 'ArrowLeft') prevGuideStep();
  }

  // Dim everything except the target: four panels, or none while waiting.
  const panels = $derived.by(() => {
    if (!rect) return [];
    const r = rect;
    return [
      `top:0;left:0;right:0;height:${Math.max(0, r.top)}px;`,
      `top:${r.top + r.height}px;left:0;right:0;bottom:0;`,
      `top:${r.top}px;left:0;width:${Math.max(0, r.left)}px;height:${r.height}px;`,
      `top:${r.top}px;left:${r.left + r.width}px;right:0;height:${r.height}px;`,
    ];
  });

  // Card below the target when there is room, else above; bottom-right while waiting.
  const cardStyle = $derived.by(() => {
    if (!rect) return 'right: 16px; bottom: 16px; width: 320px;';
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    const width = 300;
    const left = Math.max(8, Math.min(rect.left, vw - width - 8));
    const below = rect.top + rect.height + 10;
    const top = below + 140 < vh ? below : Math.max(8, rect.top - 150);
    return `left: ${left}px; top: ${top}px; width: ${width}px;`;
  });
</script>

<svelte:window onkeydown={onKey} />

{#if guide.active && step}
  <div
    bind:this={root}
    popover="manual"
    class="assist-guide"
    role="dialog"
    aria-modal="false"
    aria-label={step.message}
  >
    {#each panels as panel (panel)}
      <div class="dim" style={panel}></div>
    {/each}
    {#if rect}
      <div
        class="spot"
        style={`top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;height:${rect.height}px;`}
      ></div>
    {/if}
    <div class="card" style={cardStyle} data-assist="guide.card">
      <div class="meta">
        {m.assist_guide_step({ n: guide.index + 1, total: guide.steps.length })}
      </div>
      <p class="msg">{step.message}</p>
      {#if waiting}
        <p class="hint">{m.assist_guide_waiting()}</p>
      {/if}
      <div class="actions">
        <Button variant="ghost" size="xs" type="button" onclick={endGuide}
          >{m.assist_guide_done()}</Button
        >
        <span class="grow"></span>
        {#if guide.index > 0}
          <Button variant="secondary" size="xs" type="button" onclick={prevGuideStep}
            >{m.assist_guide_back()}</Button
          >
        {/if}
        <Button variant="primary" size="xs" type="button" onclick={nextGuideStep}>
          {guide.index + 1 >= guide.steps.length ? m.assist_guide_done() : m.assist_guide_next()}
        </Button>
      </div>
    </div>
  </div>
{/if}

<style>
  .assist-guide,
  .assist-guide:popover-open {
    position: fixed;
    inset: 0;
    width: auto;
    height: auto;
    max-width: none;
    max-height: none;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    overflow: visible;
    z-index: var(--layer-toast);
    pointer-events: none;
  }
  .assist-guide::backdrop {
    background: transparent;
  }
  /* Visual only: the user keeps operating the page underneath (pickers, windows). */
  .dim {
    position: absolute;
    background: color-mix(in srgb, var(--color-overlay) 55%, transparent);
    pointer-events: none;
  }
  .spot {
    position: absolute;
    border-radius: var(--radius-md);
    outline: 2px solid var(--color-accent);
    transition:
      top var(--duration-normal) var(--ease-standard),
      left var(--duration-normal) var(--ease-standard),
      width var(--duration-normal) var(--ease-standard),
      height var(--duration-normal) var(--ease-standard);
  }
  .card {
    position: absolute;
    pointer-events: auto;
    background: var(--color-surface-1);
    color: var(--color-foreground);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-elevation-3);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .meta {
    font-size: var(--font-size-telemetry);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-muted);
  }
  .msg {
    margin: 0;
    font-size: var(--font-size-label);
    line-height: 1.45;
  }
  .hint {
    margin: 0;
    font-size: var(--font-size-telemetry);
    color: var(--color-muted);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .grow {
    flex: 1;
  }
</style>
