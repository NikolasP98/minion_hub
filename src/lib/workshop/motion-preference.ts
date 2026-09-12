import { Container, Ticker } from 'pixi.js';

/** Observe the browser preference immediately and until the owning effect is disposed. */
export function observeReducedMotion(change: (reduced: boolean) => void): () => void {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const listener = () => change(media.matches);
  media.addEventListener('change', listener);
  listener();
  return () => media.removeEventListener('change', listener);
}

const pulses = new WeakMap<Container, () => void>();

/** A heartbeat is decorative; cancel it on preference changes and preserve the base transform. */
export function pulseSprite(target: Container, amount: number, glow?: Container | null): void {
  pulses.get(target)?.();
  if (target.destroyed || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const x = target.scale.x;
  const y = target.scale.y;
  const alpha = glow?.alpha;
  let elapsed = 0;
  let stopped = false;
  let unsubscribe = () => {};
  const finish = () => {
    if (stopped) return;
    stopped = true;
    Ticker.shared.remove(tick);
    unsubscribe();
    target.off('destroyed', finish);
    if (!target.destroyed) target.scale.set(x, y);
    if (glow && !glow.destroyed && alpha !== undefined) glow.alpha = alpha;
    pulses.delete(target);
  };
  const tick = (ticker: Ticker) => {
    elapsed += ticker.deltaMS;
    const t = Math.min(elapsed / 600, 1);
    const pulse = Math.sin(t * Math.PI);
    target.scale.set(x * (1 + amount * pulse), y * (1 + amount * pulse));
    if (glow && !glow.destroyed && alpha !== undefined) glow.alpha = alpha + (1 - alpha) * pulse;
    if (t === 1) finish();
  };
  pulses.set(target, finish);
  target.once('destroyed', finish);
  Ticker.shared.add(tick);
  unsubscribe = observeReducedMotion((reduced) => {
    if (reduced) finish();
  });
  if (stopped) unsubscribe();
}

/** Keep reaction feedback visible for its normal lifetime, suppressing only its float/fade. */
export function floatReaction(target: Container, distance: number, duration = 1200): void {
  const y = target.y;
  const alpha = target.alpha;
  let elapsed = 0;
  let stopped = false;
  let unsubscribe = () => {};
  const finish = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(expiry);
    Ticker.shared.remove(tick);
    unsubscribe();
    target.off('destroyed', finish);
    if (!target.destroyed) target.destroy();
  };
  const tick = (ticker: Ticker) => {
    elapsed += ticker.deltaMS;
    const t = Math.min(elapsed / duration, 1);
    target.y = y - t * distance;
    target.alpha = alpha * (1 - t);
  };
  const expiry = setTimeout(finish, duration);
  target.once('destroyed', finish);
  unsubscribe = observeReducedMotion((reduced) => {
    Ticker.shared.remove(tick);
    if (reduced) {
      target.y = y;
      target.alpha = alpha;
    } else Ticker.shared.add(tick);
  });
}
