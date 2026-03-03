/**
 * Svelte action that tracks pointer position on an element and sets CSS vars:
 *   --mx   0→1 (left→right)
 *   --my   0→1 (top→bottom)
 *   --active  0 or 1 (toggled via class for CSS transition compatibility)
 */
export function holo(node: HTMLElement) {
  function onMove(e: PointerEvent) {
    const rect = node.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    node.style.setProperty('--mx', String(Math.max(0, Math.min(1, x))));
    node.style.setProperty('--my', String(Math.max(0, Math.min(1, y))));
  }

  function onEnter() {
    node.classList.add('holo-active');
  }

  function onLeave() {
    node.classList.remove('holo-active');
    node.style.setProperty('--mx', '0.5');
    node.style.setProperty('--my', '0.5');
  }

  node.addEventListener('pointermove', onMove);
  node.addEventListener('pointerenter', onEnter);
  node.addEventListener('pointerleave', onLeave);

  // Set defaults so CSS vars are always defined
  node.style.setProperty('--mx', '0.5');
  node.style.setProperty('--my', '0.5');

  return {
    destroy() {
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerenter', onEnter);
      node.removeEventListener('pointerleave', onLeave);
    },
  };
}
