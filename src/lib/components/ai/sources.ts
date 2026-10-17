import type { ChatBlock, ToolResult } from '$lib/chat/blocks';

export interface AISource {
  url: string;
  title: string;
  host: string;
  snippet?: string;
}

/** Tools whose inputs/results are web provenance for the answer. */
function isWebTool(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes('web_search') || n.includes('web_fetch');
}

function httpUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

export function hostOf(url: URL): string {
  return url.hostname.replace(/^www\./, '');
}

const URL_RE = /https?:\/\/[^\s"'<>)\]}]+/g;

/** Walk a parsed JSON value, collecting `{url, title, snippet|description}` records. */
function collect(
  v: unknown,
  push: (u: unknown, title?: unknown, snippet?: unknown) => void,
  depth = 0,
) {
  if (depth > 6 || v === null || typeof v !== 'object') return;
  if (Array.isArray(v)) {
    for (const item of v) collect(item, push, depth + 1);
    return;
  }
  const o = v as Record<string, unknown>;
  if (typeof o.url === 'string') push(o.url, o.title ?? o.name, o.snippet ?? o.description);
  for (const val of Object.values(o)) collect(val, push, depth + 1);
}

/**
 * The web pages a turn drew on: URLs in its `web_search`/`web_fetch` inputs and
 * results, http(s) only, de-duplicated by URL (fragment ignored), first title wins.
 */
export function turnSources(
  blocks: readonly ChatBlock[],
  results: Readonly<Record<string, ToolResult>>,
): AISource[] {
  const byHref = new Map<string, AISource>();
  const push = (raw: unknown, title?: unknown, snippet?: unknown) => {
    const u = httpUrl(raw);
    if (!u) return;
    u.hash = '';
    const href = u.toString();
    const prev = byHref.get(href);
    const t = typeof title === 'string' && title.trim() ? title.trim() : undefined;
    const s = typeof snippet === 'string' && snippet.trim() ? snippet.trim() : undefined;
    if (prev) {
      if (t && prev.title === prev.host) prev.title = t;
      if (s && !prev.snippet) prev.snippet = s;
      return;
    }
    byHref.set(href, { url: href, host: hostOf(u), title: t ?? hostOf(u), snippet: s });
  };

  for (const b of blocks) {
    if (b.kind !== 'tool' || !isWebTool(b.name)) continue;
    const input = b.input as Record<string, unknown> | null;
    if (input && typeof input === 'object') push(input.url);
    const r = b.id ? results[b.id] : undefined;
    if (!r || r.isError) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(r.content);
    } catch {
      parsed = undefined;
    }
    if (parsed !== undefined) collect(parsed, push);
    else for (const m of r.content.matchAll(URL_RE)) push(m[0].replace(/[.,;:]+$/, ''));
  }
  return [...byHref.values()];
}
