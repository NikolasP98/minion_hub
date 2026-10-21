export interface ScrollPosition {
  key: string;
  top: number;
  left: number;
}
/** Stable structural address relative to the route viewport, including nested
 * PageBody and table scroll owners. Captures no text or record content. */
function address(root: HTMLElement, node: HTMLElement): string {
  if (node === root) return 'root';
  const indices: number[] = [];
  let current: Element = node;
  while (current !== root && current.parentElement) {
    indices.unshift(Array.prototype.indexOf.call(current.parentElement.children, current));
    current = current.parentElement;
  }
  return indices.join('.');
}
function at(root: HTMLElement, key: string): HTMLElement | undefined {
  if (key === 'root') return root;
  let node: Element | undefined = root;
  for (const part of key.split('.')) node = node?.children[Number(part)];
  return node instanceof HTMLElement ? node : undefined;
}
export function captureScroll(root: HTMLElement): ScrollPosition[] {
  return [root, ...root.querySelectorAll<HTMLElement>('*')]
    .filter((node) => node.scrollTop !== 0 || node.scrollLeft !== 0)
    .slice(0, 40)
    .map((node) => ({ key: address(root, node), top: node.scrollTop, left: node.scrollLeft }));
}
/** Retry while streamed/virtualized content arrives; stop on user intent,
 * navigation or disposal. Never pull the user back after they start scrolling. */
export function restoreScroll(root: HTMLElement, positions: ScrollPosition[]): () => void {
  let frame = 0;
  let remaining = positions;
  const deadline = performance.now() + 2000;
  const cancel = () => {
    cancelAnimationFrame(frame);
    for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
      root.removeEventListener(type, cancel, true);
  };
  const restore = () => {
    remaining = remaining.filter((position) => {
      const node = at(root, position.key);
      if (!node) return true;
      node.scrollTop = position.top;
      node.scrollLeft = position.left;
      return (
        Math.abs(node.scrollTop - position.top) > 1 || Math.abs(node.scrollLeft - position.left) > 1
      );
    });
    if (remaining.length && performance.now() < deadline) frame = requestAnimationFrame(restore);
    else cancel();
  };
  for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
    root.addEventListener(type, cancel, { capture: true, passive: true });
  frame = requestAnimationFrame(restore);
  return cancel;
}
