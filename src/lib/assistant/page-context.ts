/**
 * Page-provided context for the floating assistant (spec 013 D3).
 *
 * Tools are page-scoped already (`model-context.ts`); this is the text
 * counterpart: a page describes what is on screen in model-only prose and
 * `buildAssistantContext` appends it to the envelope at send time. One slot:
 * the page that is mounted owns it, and its disposer clears it on unmount.
 */
let text = '';

/** Set the page's context text; returns a disposer that clears it (only if still ours). */
export function setPageContext(value: string): () => void {
  text = value;
  return () => {
    if (text === value) text = '';
  };
}

export function getPageContext(): string {
  return text;
}
