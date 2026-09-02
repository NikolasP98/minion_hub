<script lang="ts">
  /**
   * Spotlight walkthrough driven by the assistant's `ui.guide` tool: dims the
   * page, cuts a hole around the current step's target (`data-assist` key),
   * and shows a coach card with Back / Next / Done. Escape or a click outside the target ends
   * it. Mounted once in (app)/+layout.
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
  let missing = $state(false);
  // Hub dialogs are native <dialog>.showModal() (top layer), so z-index alone can
  // never paint over them. A manual popover joins the top layer above the dialog.
  let root = $state<HTMLDivElement | null>(null);
  $effect(() => {
    if (!root || !guide.active) return;
    // An open modal <dialog> makes everything outside it inert (no clicks, no
    // focus). Re-parent the overlay into the dialog so its buttons stay live;
    // as a top-layer popover it still paints above the dialog itself.
    const host = document.querySelector<HTMLDialogElement>('dialog[open]');
    if (host && root.parentElement !== host) host.appendChild(root);
    try {
      root.showPopover();
    } catch {
      /* already open or popover unsupported — z-index fallback still applies */
    }
  });

  const PAD = 6;

  function measure() {
    if (!step) return;
    const el = resolveTarget(step.target);
    if (!el) {
      rect = null;
      missing = true;
      return;
    }
    missing = false;
    const r = el.getBoundingClientRect();
    rect = {
      top: r.top - PAD,
      left: r.left - PAD,
      width: r.width + PAD * 2,
      height: r.height + PAD * 2,
    };
  }

  $effect(() => {
    if (!step) return;
    const el = resolveTarget(step.target);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // Element may still be scrolling/mounting: measure now and again shortly after.
    measure();
    const t1 = setTimeout(measure, 350);
    const t2 = setTimeout(measure, 900);
    const onChange = () => measure();
    window.addEventListener('resize', onChange);
    window.addEventListener('scroll', onChange, true);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener('resize', onChange);
      window.removeEventListener('scroll', onChange, true);
    };
  });

  function onKey(e: KeyboardEvent) {
    if (!guide.active) return;
    if (e.key === 'Escape') endGuide();
    else if (e.key === 'ArrowRight' || e.key === 'Enter') nextGuideStep();
    else if (e.key === 'ArrowLeft') prevGuideStep();
  }

  // Dim everything except the target: four panels (top, bottom, left, right), or one when unknown.
  const panels = $derived.by(() => {
    if (!rect) return ['inset:0;'];
    const r = rect;
    return [
      `top:0;left:0;right:0;height:${Math.max(0, r.top)}px;`,
      `top:${r.top + r.height}px;left:0;right:0;bottom:0;`,
      `top:${r.top}px;left:0;width:${Math.max(0, r.left)}px;height:${r.height}px;`,
      `top:${r.top}px;left:${r.left + r.width}px;right:0;height:${r.height}px;`,
    ];
  });

  // Card below the target when there is room, else above; clamped to viewport.
  const cardStyle = $derived.by(() => {
    if (!rect) return 'left: 50%; top: 50%; transform: translate(-50%, -50%);';
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
    aria-modal="true"
    aria-label={step.message}
  >
    <!-- Four dim panels around the target instead of a box-shadow cut-out (tokens only).
         The target itself stays interactive; clicking a dim panel ends the walkthrough. -->
    {#each panels as panel (panel)}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="dim" style={panel} onclick={endGuide}></div>
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
      {#if missing}
        <p class="warn">{m.assist_guide_missing()}</p>
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
  /* Above dialogs: a walkthrough must be able to point at a field inside a modal. */
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
  .dim {
    position: absolute;
    background: color-mix(in srgb, var(--color-overlay) 55%, transparent);
    pointer-events: auto;
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
  .warn {
    margin: 0;
    font-size: var(--font-size-telemetry);
    color: var(--color-warning-fg);
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
