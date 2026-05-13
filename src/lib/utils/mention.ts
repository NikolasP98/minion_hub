const MENTION_RE = /@([a-z0-9_]{2,32})/g;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderMention(text: string, aliases: Map<string, string>): string {
  const escaped = escapeHtml(text);
  return escaped.replace(MENTION_RE, (match, alias: string) => {
    const userId = aliases.get(alias);
    if (!userId) return match;
    return `<span class="mention" data-user-id="${escapeHtml(userId)}">@${alias}</span>`;
  });
}
