/**
 * Keyboard movement inside a composite widget (menu, listbox): arrows wrap, Home / End jump,
 * a printable key moves to the next item starting with it. The widget stays ONE tab stop:
 * the item that has focus is the only one with tabindex 0.
 */

/** The item a key moves to, or null when the key is not a movement key. */
export function rovingTarget(
  e: KeyboardEvent,
  items: HTMLElement[],
  current: HTMLElement | null,
): HTMLElement | null {
  if (items.length === 0 || e.ctrlKey || e.metaKey || e.altKey) return null;
  const i = current ? items.indexOf(current) : -1;
  switch (e.key) {
    case 'ArrowDown':
      return items[(i + 1) % items.length];
    case 'ArrowUp':
      return items[(i - 1 + items.length) % items.length];
    case 'Home':
      return items[0];
    case 'End':
      return items[items.length - 1];
  }
  // Type-ahead. Space is not a search character: it activates the focused item.
  if (e.key.length !== 1 || e.key === ' ') return null;
  const letter = e.key.toLowerCase();
  const after = [...items.slice(i + 1), ...items.slice(0, i + 1)];
  return after.find((el) => (el.textContent ?? '').trim().toLowerCase().startsWith(letter)) ?? null;
}

/** Makes `active` the widget's single tab stop. */
export function setRovingStop(items: HTMLElement[], active: HTMLElement): void {
  for (const el of items) el.tabIndex = el === active ? 0 : -1;
}
