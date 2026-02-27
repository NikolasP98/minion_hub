export function extractText(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const m = message as Record<string, unknown>;
  const role = typeof m.role === 'string' ? m.role : '';
  const content = m.content;

  if (typeof content === 'string') return cleanText(content, role);

  if (Array.isArray(content)) {
    const parts = (content as Array<Record<string, unknown>>)
      .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text as string);
    if (parts.length > 0) return cleanText(parts.join('\n'), role);
  }

  if (typeof m.text === 'string') return cleanText(m.text, role);
  return null;
}

/** Strip the gateway metadata wrapper and extract the timestamp prefix if present. */
export function parseGatewayMetadata(text: string): { clean: string; isoTs?: string } {
  // Strip: "Conversation info (untrusted metadata):\n```json\n{...}\n```\n\n"
  const metaRe = /^Conversation info \(untrusted metadata\):\s*```(?:json)?\s[\s\S]*?```\s*\n*/;
  let clean = text.replace(metaRe, '');
  // Extract: "[Day YYYY-MM-DD HH:MM GMT±N] "
  const tsRe = /^\[([^\]]+)\]\s*/;
  let isoTs: string | undefined;
  const m = clean.match(tsRe);
  if (m) { isoTs = m[1]; clean = clean.slice(m[0].length); }
  return { clean, isoTs };
}

/** Extract a short display timestamp (e.g. "17:36") from a message object. */
export function extractMessageTimestamp(message: unknown): string | undefined {
  if (!message || typeof message !== 'object') return undefined;
  const m = message as Record<string, unknown>;
  const content = m.content;

  // Try to extract from text content metadata wrapper
  if (Array.isArray(content)) {
    for (const p of content as Array<Record<string, unknown>>) {
      if (p?.type === 'text' && typeof p.text === 'string') {
        const { isoTs } = parseGatewayMetadata(p.text);
        if (isoTs) return _formatTs(isoTs);
      }
    }
  } else if (typeof content === 'string') {
    const { isoTs } = parseGatewayMetadata(content);
    if (isoTs) return _formatTs(isoTs);
  }

  // Fallback: numeric timestamp field
  if (typeof m.timestamp === 'number') {
    return new Date(m.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return undefined;
}

function _formatTs(isoTs: string): string {
  // Try to pull HH:MM from "Thu 2025-01-23 17:36 GMT+1" style strings
  const hm = isoTs.match(/(\d{2}:\d{2})/);
  if (hm) return hm[1];
  // Fallback: try parsing as a date
  const d = new Date(isoTs);
  if (!isNaN(d.getTime())) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return isoTs;
}

export function cleanText(text: string, role: string): string {
  // Strip gateway metadata wrapper first
  text = parseGatewayMetadata(text).clean;

  if (role === 'assistant') {
    text = text.replace(/<\s*think(?:ing)?\s*>[\s\S]*?<\s*\/\s*think(?:ing)?\s*>/gi, '');
  }
  text = text.replace(
    /\[\[\s*(?:reply_to_current|reply_to\s*:\s*[^\]\n]+|audio_as_voice)\s*\]\]/gi,
    '',
  );
  text = text.replace(/^<env>[\s\S]*?<\/env>\s*/i, '');
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .trim();
}
