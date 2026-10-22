import * as m from '$lib/paraglide/messages';

const OVERSIZED_HISTORY_MARKER = '[chat.history omitted: message too large]';

/** Display only: never rewrite the stored transcript or relax its transport budget. */
export function historyOmissionNotice(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const entry = message as Record<string, unknown>;
  let text: unknown = entry.content ?? entry.text;
  if (Array.isArray(text)) {
    if (text.length !== 1) return null;
    const block = text[0];
    if (!block || typeof block !== 'object' || block.type !== 'text') return null;
    text = block.text;
  }
  // Exact standalone legacy markers also occur in cached history without metadata.
  // Quoted examples, mixed blocks and genuine prose must remain visible as written.
  if (typeof text !== 'string' || text.trim() !== OVERSIZED_HISTORY_MARKER) return null;
  const metadata = entry.__openclaw;
  if (metadata !== undefined) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
    const state = metadata as Record<string, unknown>;
    if (state.truncated !== true || state.reason !== 'oversized') return null;
  }
  return m.chat_history_oversized();
}
