// shortcut: Android fires a native contextmenu on long-press; this is for iOS Safari — promote to a ui primitive when a second host appears
const HOLD_MS = 500;
const SLOP_PX = 8;

/** Touch/pen press-and-hold opens `onOpen`; the click that follows the release is swallowed once. */
export function longpress(node: HTMLElement, onOpen: (at: { x: number; y: number }) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let start = { x: 0, y: 0 };
  let fired = false;
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const down = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    fired = false;
    start = { x: e.clientX, y: e.clientY };
    clear();
    timer = setTimeout(() => {
      fired = true;
      onOpen(start);
    }, HOLD_MS);
  };
  const move = (e: PointerEvent) => {
    if (timer && Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP_PX) clear();
  };
  const click = (e: MouseEvent) => {
    if (!fired) return;
    fired = false;
    e.preventDefault();
    e.stopPropagation();
  };
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointerup', clear);
  node.addEventListener('pointercancel', clear);
  node.addEventListener('pointermove', move);
  node.addEventListener('click', click, true);
  return {
    destroy() {
      clear();
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointerup', clear);
      node.removeEventListener('pointercancel', clear);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('click', click, true);
    },
  };
}
