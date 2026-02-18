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

export function cleanText(text: string, role: string): string {
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
