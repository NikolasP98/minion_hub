/**
 * Hub animation system — reusable Svelte transitions and actions.
 *
 * All timing defaults are pulled from `--duration-*` / `--ease-*` CSS custom
 * properties so they respect the design system and theme overrides.
 *
 * Usage:
 *   import { fadeScale, slideIn, press } from '$lib/animations';
 *   <div transition:fadeScale={{ duration: 300 }}>…</div>
 *   <button use:press onclick={…}>…</button>
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TransitionParams {
  /** Override duration in ms (defaults to --duration-normal). */
  duration?: number;
  /** Override delay in ms. */
  delay?: number;
  /** CSS easing string (defaults to --ease-spring). */
  easing?: string;
}

export interface StaggerParams extends TransitionParams {
  /** Index of this item (0-based). */
  index?: number;
  /** Per-item stagger delay in ms. */
  staggerMs?: number;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function resolveDuration(params?: TransitionParams): number {
  if (params?.duration != null) return params.duration;
  const v = cssVar('--duration-normal', '250ms');
  return parseFloat(v.endsWith('ms') ? v.slice(0, -2) : (parseFloat(v) * 1000).toString());
}

function resolveEasing(params?: TransitionParams, name?: string): string {
  if (params?.easing) return params.easing;
  return cssVar(name ?? '--ease-spring', 'cubic-bezier(0.34, 1.56, 0.64, 1)');
}

// ---------------------------------------------------------------------------
// Transition factories
// ---------------------------------------------------------------------------

/**
 * Fade + scale-up — the standard enter transition for modals, cards, toasts.
 * Mirrors `modal-in` / `toast-in` / `card-expand` keyframes.
 */
export function fadeScale(
  node: Element,
  params?: TransitionParams,
): { duration: number; delay: number; css: (t: number, u: number) => string } {
  const dur = resolveDuration(params);
  const delay = params?.delay ?? 0;
  const easing = resolveEasing(params);

  return {
    duration: dur,
    delay,
    css: (t: number, u: number) =>
      `opacity: ${t}; transform: scale(${0.95 + t * 0.05}) translateY(${(1 - t) * 8}px); transition: opacity ${dur}ms ${easing}, transform ${dur}ms ${easing};`,
  };
}

/**
 * Fade + slide from the right — toast-style horizontal entrance.
 */
export function slideIn(
  node: Element,
  params?: TransitionParams & { from?: 'left' | 'right' },
): { duration: number; delay: number; css: (t: number, u: number) => string } {
  const dur = resolveDuration(params);
  const delay = params?.delay ?? 0;
  const easing = resolveEasing(params);
  const dir = params?.from === 'left' ? -1 : 1;

  return {
    duration: dur,
    delay,
    css: (t: number) =>
      `opacity: ${t}; transform: translateX(${(1 - t) * 16 * dir}px) scale(${0.96 + t * 0.04}); transition: opacity ${dur}ms ${easing}, transform ${dur}ms ${easing};`,
  };
}

/**
 * Fade + slide up — for bottom sheets, inline reveals.
 */
export function slideUp(
  node: Element,
  params?: TransitionParams,
): { duration: number; delay: number; css: (t: number) => string } {
  const dur = resolveDuration(params);
  const delay = params?.delay ?? 0;
  const easing = resolveEasing(params, '--ease-out');

  return {
    duration: dur,
    delay,
    css: (t: number) =>
      `opacity: ${t}; transform: translateY(${(1 - t) * 12}px); transition: opacity ${dur}ms ${easing}, transform ${dur}ms ${easing};`,
  };
}

/**
 * Pure fade in.
 */
export function fadeIn(
  node: Element,
  params?: TransitionParams,
): { duration: number; delay: number; css: (t: number) => string } {
  const dur = resolveDuration(params);
  const delay = params?.delay ?? 0;
  const easing = resolveEasing(params, '--ease-out');

  return {
    duration: dur,
    delay,
    css: (t: number) => `opacity: ${t}; transition: opacity ${dur}ms ${easing};`,
  };
}

/**
 * Scale pop-in (0.8 → 1). For badges, tooltips, checkmark confirmation.
 */
export function scaleIn(
  node: Element,
  params?: TransitionParams,
): { duration: number; delay: number; css: (t: number) => string } {
  const dur = resolveDuration(params);
  const delay = params?.delay ?? 0;
  const easing = resolveEasing(params);

  return {
    duration: dur,
    delay,
    css: (t: number) =>
      `opacity: ${t}; transform: scale(${0.8 + t * 0.2}); transition: opacity ${dur}ms ${easing}, transform ${dur}ms ${easing};`,
  };
}

// ---------------------------------------------------------------------------
// Stagger helper
// ---------------------------------------------------------------------------

/**
 * Returns a Svelte transition factory that staggers items by index.
 *
 * Example — animate a list with index-based delay:
 *   {#each items as item, i (item.id)}
 *     <div transition:staggerList={{ index: i, staggerMs: 60 }}>
 *       {item.label}
 *     </div>
 *   {/each}
 */
export function staggerList(
  node: Element,
  params?: StaggerParams,
): { duration: number; delay: number; css: (t: number) => string } {
  const dur = resolveDuration(params);
  const baseDelay = params?.delay ?? 0;
  const staggerMs = params?.staggerMs ?? 60;
  const index = params?.index ?? 0;
  const totalDelay = baseDelay + index * staggerMs;
  const easing = resolveEasing(params);

  return {
    duration: dur,
    delay: totalDelay,
    css: (t: number) =>
      `opacity: ${t}; transform: translateY(${(1 - t) * 10}px); transition: opacity ${dur}ms ${easing}, transform ${dur}ms ${easing};`,
  };
}

// ---------------------------------------------------------------------------
// Svelte actions
// ---------------------------------------------------------------------------

/**
 * Press depression action — applies `active:scale-[0.97]` on pointerdown.
 * Attach to any interactive element.
 *
 *   <div use:press onclick={…}>…</div>
 */
export function press(node: HTMLElement) {
  function down() {
    node.style.transition = 'transform 75ms cubic-bezier(0.2, 0, 0, 1)';
    node.style.transform = 'scale(0.97)';
  }
  function up() {
    node.style.transform = 'scale(1)';
  }

  node.addEventListener('pointerdown', down);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointerleave', up);

  return {
    destroy() {
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointerleave', up);
    },
  };
}
