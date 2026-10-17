<script lang="ts">
  /**
   * The assistant as a little character rather than an indicator (SmoothUI
   * `ai-orb-face`, MIT): a marbled orb in the theme accent with two capsule
   * eyes. Status is carried by expression — squints while it thinks and looks
   * away, eyes wide while it listens, happy arcs and a hop when it finishes,
   * spiral eyes and a wobble when it breaks. It blinks, and follows the pointer.
   */
  import { untrack } from 'svelte';
  import { Spring, prefersReducedMotion } from 'svelte/motion';
  import { theme } from '$lib/state/ui/theme.svelte';
  import AiOrb from './AiOrb.svelte';
  import { orbPalette } from './orb-color';
  import { ORB_SPHERE_FRACTION } from './orb-shader';
  import {
    EYE_HEIGHT,
    EYE_OFFSET,
    EYE_Y,
    GAZE_RANGE,
    SACCADE_TARGETS,
    SPIRAL,
    STATE_SATURATION,
    VIEWBOX,
    energyBucket,
    eyeGeometry,
    gazeFor,
    resolveExpression,
    type Expression,
    type ExpressionName,
    type FaceState,
  } from './orb-face';

  interface Props {
    status?: FaceState;
    /** Live audio level 0–1, read every frame (no re-render): speaking stirs the interior, listening breathes. */
    amplitude?: () => number;
    /** Rendered size: px number, or any CSS length (e.g. '100%'). */
    diameter?: number | string;
    /** Follow the pointer. Off inside dense UI where many faces would be noise. */
    gaze?: boolean;
    /** Set the face directly, ignoring `state`. */
    expression?: ExpressionName | Expression;
    /** Accessible name. Omit to keep the character decorative. */
    'aria-label'?: string;
    class?: string;
  }

  const {
    status = 'idle',
    amplitude,
    diameter = 128,
    gaze = true,
    expression,
    'aria-label': ariaLabel,
    class: cls = '',
  }: Props = $props();

  const palette = $derived(orbPalette(theme.accent.value));
  const face = $derived(resolveExpression(status, expression));
  const reduced = $derived(prefersReducedMotion.current);
  const broken = $derived(status === 'error');
  const thinking = $derived(status === 'thinking');

  let root = $state<HTMLDivElement | null>(null);
  let bodyEl = $state<HTMLDivElement | null>(null);
  let lid = $state(1);
  let lidClosing = $state(false);
  let energy = $state(0);
  const look = new Spring({ x: 0, y: 0 }, { stiffness: 0.12, damping: 0.55 });

  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
    return t;
  };
  $effect(() => () => {
    for (const t of timers) clearTimeout(t);
  });

  // Snap shut, ease back open — an even-timed blink reads as a machine.
  function blink(double = false) {
    lidClosing = true;
    lid = 0.08;
    later(() => {
      lidClosing = false;
      lid = 1;
      if (double) later(() => blink(false), 90);
    }, 75);
  }

  // Idle blinking every 3.2–5.8 s, a double one time in four.
  $effect(() => {
    if (reduced || broken) return;
    let t: ReturnType<typeof setTimeout>;
    const schedule = () => {
      t = later(
        () => {
          blink(Math.random() < 0.25);
          schedule();
        },
        3200 + Math.random() * 2600,
      );
    };
    schedule();
    return () => clearTimeout(t);
  });

  // Gaze follows the pointer — except while thinking, when looking away is
  // exactly what makes "thinking" legible.
  $effect(() => {
    if (!gaze || reduced || thinking || broken) return;
    const move = (e: PointerEvent) => {
      if (!root) return;
      const r = root.getBoundingClientRect();
      look.target = gazeFor(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    };
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  });

  // Thinking saccades: up and away, every 0.7–1.4 s.
  $effect(() => {
    if (!thinking || reduced) return;
    let i = 0;
    let t: ReturnType<typeof setTimeout>;
    const schedule = () => {
      t = later(
        () => {
          const s = SACCADE_TARGETS[i++ % SACCADE_TARGETS.length];
          look.target = { x: s.x * GAZE_RANGE, y: s.y * GAZE_RANGE };
          schedule();
        },
        700 + Math.random() * 700,
      );
    };
    schedule();
    return () => clearTimeout(t);
  });

  const canAnimate = () => !!bodyEl && typeof bodyEl.animate === 'function' && !reduced;

  // Error: centre the eyes and wobble once; the spiral eyes stay while broken.
  $effect(() => {
    if (!broken) return;
    untrack(() => {
      look.set({ x: 0, y: 0 }, { instant: true });
      if (!canAnimate()) return;
      bodyEl!.animate(
        [0, -11, 9, -7, 5, -3, 0].map((deg, k) => ({
          transform: `translateX(${[0, -5, 4, -3, 2, -1, 0][k]}%) rotate(${deg}deg)`,
        })),
        { duration: 1050, easing: 'cubic-bezier(0.45, 0, 0.55, 1)' },
      );
    });
  });

  // Done: one happy hop — the squash-and-stretch is the whole payload.
  $effect(() => {
    if (status !== 'done') return;
    untrack(() => {
      if (!canAnimate()) return;
      const sx = [1, 1.08, 0.94, 1.04, 0.99, 1];
      const sy = [1, 0.9, 1.08, 0.95, 1.02, 1];
      const y = [0, 3, -9, 0, -3, 0];
      const offsets = [0, 0.12, 0.4, 0.62, 0.82, 1];
      bodyEl!.animate(
        sx.map((_, k) => ({
          transform: `translateY(${y[k]}%) scale(${sx[k]}, ${sy[k]})`,
          offset: offsets[k],
        })),
        { duration: 850, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
      );
    });
  });

  // Live audio: listening breathes the body; speaking stirs the interior.
  // Read every frame, written straight to the element — no re-render per frame.
  $effect(() => {
    const read = amplitude;
    if (!read || reduced || (status !== 'listening' && status !== 'streaming')) {
      energy = 0;
      return;
    }
    const breathe = status === 'listening';
    let raf = 0;
    const tick = () => {
      const level = Math.min(1, Math.max(0, read() || 0));
      const bucket = energyBucket(level);
      if (bucket !== energy) energy = bucket;
      if (breathe && bodyEl) {
        bodyEl.style.transform = `translateY(${-level * 2}%) scale(${1 + level * 0.07})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (bodyEl) bodyEl.style.transform = '';
    };
  });

  // The orb draws its sphere at 86% of its box, so the box is scaled up to
  // land the sphere on the r=48 circle the face was drawn around.
  const bodySpan = (96 / VIEWBOX / ORB_SPHERE_FRACTION) * 100;
  const bodyInset = (100 - bodySpan) / 2;
  const eyes = $derived([
    { side: -1 as const, g: eyeGeometry(face.left, -1) },
    { side: 1 as const, g: eyeGeometry(face.right, 1) },
  ]);
</script>

<div
  bind:this={root}
  class="ai-orb-face {cls}"
  style:width={typeof diameter === 'number' ? `${diameter}px` : diameter}
  style:height={typeof diameter === 'number' ? `${diameter}px` : diameter}
  style:filter="saturate({STATE_SATURATION[status]})"
  data-state={status}
>
  <div class="body" bind:this={bodyEl}>
    <div
      class="orb"
      style:inset="{bodyInset}%"
      style:width="{bodySpan}%"
      style:height="{bodySpan}%"
    >
      <AiOrb
        stops={palette.stops}
        body={palette.body}
        edge={palette.edge}
        flow={0.6 + energy * 0.36}
        turbulence={0.4 + energy * 0.32}
      />
    </div>
    <svg
      viewBox="0 0 {VIEWBOX} {VIEWBOX}"
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : 'true'}
    >
      {#if broken}
        {#each [-1, 1] as side (side)}
          <g transform="translate({50 + side * EYE_OFFSET} {EYE_Y + EYE_HEIGHT / 2}) scale(1.5)">
            <path
              class="dizzy"
              class:ccw={side === -1}
              d={SPIRAL}
              fill="none"
              stroke={palette.feature}
              stroke-width="3"
              stroke-linecap="round"
            />
          </g>
        {/each}
      {:else}
        <g transform="translate({look.current.x} {look.current.y})">
          {#each eyes as { side, g } (side)}
            <g
              class="lid"
              class:closing={lidClosing}
              style:transform-origin="{g.cx}px {g.cy}px"
              style:transform="scaleY({lid})"
            >
              <rect
                class="eye"
                fill={palette.feature}
                style:x="{g.x}px"
                style:y="{g.y}px"
                style:width="{g.width}px"
                style:height="{g.height}px"
                style:rx="{g.rx}px"
                style:transform-origin="{g.cx}px {g.cy}px"
                style:transform="rotate({g.rotate}deg)"
              />
            </g>
          {/each}
        </g>
      {/if}
    </svg>
  </div>
</div>

<style>
  .ai-orb-face {
    position: relative;
    display: block;
    flex-shrink: 0;
  }
  .body {
    position: absolute;
    inset: 0;
    transform-origin: 50% 60%;
  }
  .orb {
    position: absolute;
  }
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .eye {
    transition:
      x var(--duration-normal) var(--ease-spring),
      y var(--duration-normal) var(--ease-spring),
      width var(--duration-normal) var(--ease-spring),
      height var(--duration-normal) var(--ease-spring),
      rx var(--duration-normal) var(--ease-spring),
      transform var(--duration-normal) var(--ease-spring);
  }
  .lid {
    transition: transform var(--duration-fast) var(--ease-enter);
  }
  .lid.closing {
    transition: transform var(--duration-instant) var(--ease-exit);
  }
  .dizzy {
    transform-box: fill-box;
    transform-origin: center;
    animation: ai-face-dizzy calc(var(--duration-slow) * 6) linear infinite;
  }
  .dizzy.ccw {
    animation-direction: reverse;
  }
  @keyframes ai-face-dizzy {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dizzy {
      animation: none;
    }
  }
</style>
