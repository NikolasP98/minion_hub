/**
 * Game loop: requestAnimationFrame-based update/render cycle with delta time capping.
 *
 * Every frame synchronizes live state, updates lifecycle and renders. The update
 * callback receives the preference so it can suppress decoration without freezing lifecycle.
 * Delta time is clamped to MAX_DELTA_TIME_SEC (0.1s) to prevent physics
 * explosions when the tab is backgrounded or the frame takes too long.
 *
 * IMPROVEMENT: `imageSmoothingEnabled = false` is set only once at init,
 * not redundantly on every frame.
 */

/** Maximum delta time per frame (seconds). Prevents large jumps. */
const MAX_DELTA_TIME_SEC = 0.1;

export interface GameLoopCallbacks {
  /** Read live state even when decorative movement is paused. */
  sync?: () => void;
  update: (dt: number, reducedMotion: boolean) => void;
  render: (ctx: CanvasRenderingContext2D) => void;
}

/**
 * Start a game loop on the given canvas.
 *
 * @param canvas - The HTML canvas element to render to
 * @param callbacks - update and render functions called each frame
 * @returns A cleanup function that stops the loop and cancels the pending rAF
 */
export function startGameLoop(canvas: HTMLCanvasElement, callbacks: GameLoopCallbacks): () => void {
  const ctx = canvas.getContext('2d')!;
  // Disable image smoothing once at init for crisp pixel art rendering
  ctx.imageSmoothingEnabled = false;

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduceMotion = motion.matches;
  const motionChanged = () => {
    reduceMotion = motion.matches;
    lastTime = 0; // Resuming never integrates time spent with motion paused.
  };
  motion.addEventListener('change', motionChanged);

  let lastTime = 0;
  let rafId = 0;
  let stopped = false;

  const frame = (time: number): void => {
    if (stopped) return;
    const dt = lastTime === 0 ? 0 : Math.min((time - lastTime) / 1000, MAX_DELTA_TIME_SEC);
    lastTime = time;

    callbacks.sync?.();
    callbacks.update(dt, reduceMotion);
    callbacks.render(ctx);

    rafId = requestAnimationFrame(frame);
  };

  rafId = requestAnimationFrame(frame);

  return () => {
    stopped = true;
    motion.removeEventListener('change', motionChanged);
    cancelAnimationFrame(rafId);
  };
}
