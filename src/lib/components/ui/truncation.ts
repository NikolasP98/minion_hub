/**
 * Is an ellipsised label actually cut off? (HC-023)
 *
 * A `truncate` label gets the shared `Tooltip` ONLY while its text overflows:
 * the tooltip repeats what the eye can already read otherwise, which is noise
 * on every untruncated header. Measured on layout change (one
 * `ResizeObserver` per label, which also fires once on observe), never per
 * frame and never in a `$effect` that would re-run on unrelated state.
 */
export function isTruncated(el: HTMLElement): boolean {
  return el.scrollWidth > el.clientWidth;
}

/**
 * Svelte action: reports `isTruncated(el)` on mount and whenever the label's
 * box changes. Engines without `ResizeObserver` (happy-dom) measure once.
 */
export function observeTruncation(el: HTMLElement, report: (truncated: boolean) => void) {
  let last: boolean | null = null;
  const measure = () => {
    const next = isTruncated(el);
    if (next !== last) report((last = next));
  };
  measure();
  const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
  ro?.observe(el);
  return { destroy: () => ro?.disconnect() };
}
