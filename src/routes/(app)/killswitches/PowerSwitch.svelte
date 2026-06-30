<script lang="ts">
  import { Power, LoaderCircle } from 'lucide-svelte';

  interface Props {
    /** true = service live/running (green); false = killed (dim red). */
    live: boolean;
    /** false = placeholder for a not-yet-wired subsystem → inert/disabled. */
    available?: boolean;
    /** RPC in flight → spinner, no input. */
    busy?: boolean;
    /** 'lg' = master hero button; 'md' = tile button. */
    size?: 'md' | 'lg';
    /** When live, require a press-and-hold to kill (master only). Revive stays instant. */
    holdToKill?: boolean;
    /** Accessible label, e.g. "Telegram channel". */
    label: string;
    /** Fired with the intended next state once the gesture commits. */
    onactivate: (nextLive: boolean) => void;
  }

  let {
    live,
    available = true,
    busy = false,
    size = 'md',
    holdToKill = false,
    label,
    onactivate,
  }: Props = $props();

  let holding = $state(false);

  const box = $derived(size === 'lg' ? 'h-28 w-28' : 'h-20 w-20');
  const glyph = $derived(size === 'lg' ? 34 : 26);
  const interactive = $derived(available && !busy);

  function fire(next: boolean) {
    if (!interactive) return;
    onactivate(next);
  }

  function onclick() {
    if (!interactive) return;
    if (!live) return fire(true); // revive: always instant
    if (!holdToKill) return fire(false); // single kill: instant (revive is the undo)
    // holdToKill && live → kill is committed by the hold gesture, not the click
  }

  function startHold() {
    if (interactive && live && holdToKill) holding = true;
  }
  function cancelHold() {
    holding = false;
  }
  function onHoldComplete() {
    // animationend only fires when the 1.2s fill runs to completion; an early
    // pointerup removes the class and no event fires → safe cancel.
    if (holding) {
      holding = false;
      fire(false);
    }
  }

  // role="switch": aria-checked tracks running-state; busy announces in-flight.
  const aria = $derived(
    !available
      ? `${label} — not yet available`
      : busy
        ? `${label} — updating`
        : live
          ? `${label} — live, ${holdToKill ? 'hold to kill' : 'press to kill'}`
          : `${label} — killed, press to restore`,
  );
</script>

<button
  type="button"
  role="switch"
  aria-checked={live}
  aria-busy={busy}
  aria-label={aria}
  disabled={!interactive}
  class="power {box}"
  class:live
  class:killed={!live}
  class:holding
  class:unavailable={!available}
  {onclick}
  onpointerdown={startHold}
  onpointerup={cancelHold}
  onpointerleave={cancelHold}
>
  {#if holdToKill && live}
    <svg class="ring" viewBox="0 0 100 100" aria-hidden="true">
      <circle class="ring-fill" cx="50" cy="50" r="46" onanimationend={onHoldComplete} />
    </svg>
  {/if}
  {#if busy}
    <LoaderCircle size={glyph} class="animate-spin" />
  {:else}
    <Power size={glyph} strokeWidth={2.25} />
  {/if}
</button>

<style>
  .power {
    position: relative;
    display: grid;
    place-items: center;
    border-radius: 9999px;
    --tw-ring-inset: inset;
    transition:
      box-shadow 250ms ease,
      transform 120ms ease,
      color 200ms ease,
      background-color 200ms ease;
    outline: none;
  }
  .power:focus-visible {
    box-shadow: 0 0 0 3px var(--color-ring, #6366f1);
  }
  .power:not(:disabled):active {
    transform: scale(0.94);
  }

  /* LIVE — energized emerald, soft glow */
  .live {
    color: var(--color-success, #34d399);
    background: radial-gradient(
      circle at 50% 38%,
      color-mix(in oklab, var(--color-success, #10b981) 28%, transparent),
      color-mix(in oklab, var(--color-success, #10b981) 6%, transparent)
    );
    box-shadow:
      inset 0 0 0 1px color-mix(in oklab, var(--color-success, #10b981) 55%, transparent),
      0 0 26px -6px var(--color-success, #10b981);
  }
  .live:hover:not(:disabled) {
    box-shadow:
      inset 0 0 0 1px color-mix(in oklab, var(--color-success, #10b981) 70%, transparent),
      0 0 34px -4px var(--color-success, #10b981);
  }

  /* KILLED — powered down: dim red, NO glow (absence of light is the signal) */
  .killed {
    color: color-mix(in oklab, var(--color-destructive, #f87171) 80%, transparent);
    background: radial-gradient(
      circle at 50% 38%,
      color-mix(in oklab, var(--color-destructive, #ef4444) 12%, transparent),
      transparent
    );
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--color-destructive, #ef4444) 38%, transparent);
  }
  .killed:hover:not(:disabled) {
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--color-destructive, #ef4444) 60%, transparent);
  }

  /* UNAVAILABLE — intentionally inert, not broken */
  .unavailable {
    color: var(--color-muted-foreground, #71717a);
    background: transparent;
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--color-muted-foreground, #71717a) 25%, transparent);
    border-style: dashed;
    cursor: not-allowed;
    opacity: 0.55;
  }

  /* Hold-to-kill radial fill (master) */
  .ring {
    position: absolute;
    inset: -5px;
    width: calc(100% + 10px);
    height: calc(100% + 10px);
    transform: rotate(-90deg);
    pointer-events: none;
  }
  .ring-fill {
    fill: none;
    stroke: var(--color-destructive, #ef4444);
    stroke-width: 4;
    stroke-linecap: round;
    /* 2·π·46 ≈ 289 */
    stroke-dasharray: 289;
    stroke-dashoffset: 289;
  }
  .holding .ring-fill {
    animation: ks-fill 1200ms linear forwards;
  }
  @keyframes ks-fill {
    to {
      stroke-dashoffset: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .holding .ring-fill {
      animation-duration: 1200ms; /* keep the deliberate hold; just no easing flourish */
    }
    .power:not(:disabled):active {
      transform: none;
    }
  }
</style>
