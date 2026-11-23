// shortcut: Android fires a native contextmenu on long-press; this is for iOS Safari — promote to a ui primitive when a second host appears
export interface LongpressDetail {
  x: number;
  y: number;
  pointerId: number;
  target: EventTarget | null;
}
export interface LongpressOptions {
  /** Hold time in ms (500). */
  ms?: number;
  /** Movement in px that cancels the hold (8). */
  slop?: number;
  onhold: (detail: LongpressDetail) => void;
  /** Pointer released or cancelled after a hold fired. */
  onend?: () => void;
}
type Param = LongpressOptions | ((at: { x: number; y: number }) => void);

const norm = (p: Param): LongpressOptions => (typeof p === 'function' ? { onhold: p } : p);

/** Touch/pen press-and-hold calls `onhold`; the click that follows the release is swallowed once. */
export function longpress(node: HTMLElement, param: Param) {
  let opts = norm(param);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let start = { x: 0, y: 0 };
  let fired = false;
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const down = (e: PointerEvent) => {
    fired = false; // a hold that ended without a click must not swallow a later one (mouse included)
    if (e.pointerType === 'mouse' || !e.isPrimary) return;
    start = { x: e.clientX, y: e.clientY };
    const { pointerId, target } = e;
    clear();
    timer = setTimeout(() => {
      timer = undefined;
      fired = true;
      opts.onhold({ ...start, pointerId, target });
    }, opts.ms ?? 500);
  };
  const move = (e: PointerEvent) => {
    if (timer && Math.hypot(e.clientX - start.x, e.clientY - start.y) > (opts.slop ?? 8)) clear();
  };
  const end = (e: PointerEvent) => {
    if (!e.isPrimary) return;
    clear();
    if (fired) opts.onend?.();
  };
  const click = (e: MouseEvent) => {
    if (!fired) return;
    fired = false;
    e.preventDefault();
    e.stopPropagation();
  };
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);
  node.addEventListener('pointermove', move);
  node.addEventListener('click', click, true);
  return {
    update(next: Param) {
      opts = norm(next);
    },
    destroy() {
      clear();
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointerup', end);
      node.removeEventListener('pointercancel', end);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('click', click, true);
    },
  };
}
