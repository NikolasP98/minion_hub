/** Pure helpers for C3 similar-wins. No I/O. */

/**
 * Render a conversation as labelled, chronological lines for embedding:
 * inbound → "Cliente: …", outbound → "Nosotros: …". Empty bodies are skipped;
 * the result is truncated to `maxChars` (default 4000) to bound embed cost.
 */
export function buildConversationText(
  rows: { direction: string; content: string | null }[],
  opts?: { maxChars?: number },
): string {
  const max = opts?.maxChars ?? 4000;
  const text = rows
    .map((r) => {
      const body = (r.content ?? '').trim();
      if (!body) return null;
      const who = r.direction === 'inbound' ? 'Cliente' : 'Nosotros';
      return `${who}: ${body}`;
    })
    .filter((l): l is string => l !== null)
    .join('\n');
  return text.length > max ? text.slice(0, max) : text;
}

/** Conversations averaging < 4 messages are too thin for meaningful similarity. */
export function isThin(avgMsgCount: number): boolean {
  return avgMsgCount < 4;
}
