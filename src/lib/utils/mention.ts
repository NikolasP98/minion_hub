import { escHtml } from './format';

const MENTION_RE = /@([a-z0-9_]{2,32})/g;

export function renderMention(text: string, aliases: Map<string, string>): string {
  const escaped = escHtml(text);
  return escaped.replace(MENTION_RE, (match, alias: string) => {
    const userId = aliases.get(alias);
    if (!userId) return match;
    return `<span class="mention" data-user-id="${escHtml(userId)}">@${alias}</span>`;
  });
}
