import * as m from '$lib/paraglide/messages';

// Shared, framework-free helpers for rendering ChatMessage content blocks.
//
// Normalizes BOTH content-block schemas the gateway hands back:
//  - Anthropic-style: {type:'text'|'thinking'|'redacted_thinking'|'tool_use'|'tool_result'|'image'}
//  - gateway-native:  {type:'toolCall', id, name, arguments} blocks, plus whole
//    messages shaped {role:'toolResult', toolCallId, toolName, content, isError}
//
// Hoisted from ChatTurn.svelte's block derivation + home/+page.svelte's message
// aggregation (5 independent copies of this logic before this module existed) —
// see specs/2026-07-06-hub-tanstack-ai-assessment.md §3 W1.

export type ChatBlock =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; id: string; name: string; input: unknown }
  | { kind: 'image' };

export interface ToolResult {
  content: string;
  isError: boolean;
}

/** Every gateway/Anthropic block shape is `unknown` at this layer. */
type RawBlock = Record<string, unknown>;

/** `content` as a block array, or `[]` for plain-text/empty content. */
export function contentBlocks(content: unknown): RawBlock[] {
  return Array.isArray(content) ? (content as RawBlock[]) : [];
}

/**
 * Normalize a message's `content` (string, Anthropic-style block array, or
 * gateway-native block array) into a flat render list. `tool_result` blocks
 * are intentionally dropped here — they're folded into the matching tool
 * card via `toolResultsById`, not rendered as their own block.
 */
export function normalizeBlocks(content: unknown): ChatBlock[] {
  if (typeof content === 'string') {
    return content.trim() ? [{ kind: 'text', text: content }] : [];
  }
  const out: ChatBlock[] = [];
  for (const b of contentBlocks(content)) {
    if (!b || typeof b !== 'object') continue;
    const t = b.type;
    if (t === 'text' && typeof b.text === 'string') {
      if (b.text.trim()) out.push({ kind: 'text', text: b.text });
    } else if (t === 'thinking' || t === 'redacted_thinking') {
      const txt =
        typeof b.thinking === 'string'
          ? b.thinking
          : typeof b.text === 'string'
            ? b.text
            : t === 'redacted_thinking'
              ? '(reasoning hidden)'
              : '';
      if (txt) out.push({ kind: 'thinking', text: txt });
    } else if (t === 'tool_use' || t === 'toolCall') {
      // `tool_use` = Anthropic-style; `toolCall` = gateway-native schema
      // (chat.history returns `{type:'toolCall', id, name, arguments}`).
      out.push({
        kind: 'tool',
        id: typeof b.id === 'string' ? b.id : '',
        name: typeof b.name === 'string' ? b.name : 'tool',
        // Gateway history may carry `arguments` as a JSON string — parse it so
        // consumers (the chat_artifact card) see the object either way.
        input: t === 'toolCall' ? parseMaybeJson(b.arguments) : b.input,
      });
    } else if (t === 'image' || t === 'image_url') {
      out.push({ kind: 'image' });
    }
  }
  return out;
}

/** Best-effort text extraction from a tool_result's `content` (string, block array, or object). */
export function stringifyToolResult(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as RawBlock[])
      .map((p) => (p?.type === 'text' && typeof p.text === 'string' ? (p.text as string) : ''))
      .filter(Boolean)
      .join('\n');
  }
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content ?? '');
  }
}

/**
 * `tool_use_id`/`toolCallId` → result, collected across a message list, so a
 * tool card can show its outcome. Handles both content shapes:
 *  - gateway-native: a whole message `{role:'toolResult', toolCallId, content, isError}`
 *  - Anthropic-style: `tool_result` blocks inside a (user-role) message's content array
 */
export function toolResultsById(messages: readonly unknown[]): Record<string, ToolResult> {
  const map: Record<string, ToolResult> = {};
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    const mm = m as { role?: string; content?: unknown; toolCallId?: string; isError?: boolean };
    if (mm.role === 'toolResult' && typeof mm.toolCallId === 'string') {
      map[mm.toolCallId] = { content: stringifyToolResult(mm.content), isError: !!mm.isError };
      continue;
    }
    for (const b of contentBlocks(mm.content)) {
      if (b?.type === 'tool_result' && typeof b.tool_use_id === 'string') {
        map[b.tool_use_id as string] = {
          content: stringifyToolResult(b.content),
          isError: !!b.is_error,
        };
      }
    }
  }
  return map;
}

/**
 * A message that's purely a tool-output carrier (never shown as its own
 * bubble) — either the gateway-native `role:'toolResult'` shape, or an
 * Anthropic-style message whose content is entirely `tool_result` blocks.
 */
function parseMaybeJson(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) return v;
  try {
    return JSON.parse(t);
  } catch {
    return v;
  }
}

export function isToolResultOnly(m: unknown): boolean {
  if (!m || typeof m !== 'object') return false;
  const mm = m as { role?: string; content?: unknown };
  if (mm.role === 'toolResult') return true;
  const blocks = contentBlocks(mm.content);
  return blocks.length > 0 && blocks.every((b) => b?.type === 'tool_result');
}

/**
 * Fold consecutive meta-only assistant turns (tool calls / reasoning, no reply
 * text) into the reply that follows them, so a tool loop renders as ONE
 * "N tool uses" row above the answer instead of one row + timestamp per call.
 * Tool-result carrier messages pass through untouched (`toolResultsById` reads
 * the original list). A trailing run with no reply yet becomes one synthetic
 * assistant message stamped with the last call's time.
 */
type ChatMsg = { role?: string; content?: unknown; timestamp?: number };
export function foldToolTurns(messages: readonly unknown[]): ChatMsg[] {
  const out: ChatMsg[] = [];
  let pending: RawBlock[] = [];
  let pendingTs: number | undefined;
  const flush = () => {
    if (pending.length) out.push({ role: 'assistant', content: pending, timestamp: pendingTs });
    pending = [];
    pendingTs = undefined;
  };
  for (const m of messages) {
    const mm = m as ChatMsg;
    if (isToolResultOnly(m)) {
      out.push(mm);
      continue;
    }
    if (mm.role === 'user') {
      flush();
      out.push(mm);
      continue;
    }
    const blocks = normalizeBlocks(mm.content);
    if (blocks.length > 0 && blocks.every((b) => b.kind === 'tool' || b.kind === 'thinking')) {
      pending.push(...contentBlocks(mm.content));
      pendingTs = mm.timestamp ?? pendingTs;
      continue;
    }
    if (pending.length) {
      const own =
        typeof mm.content === 'string'
          ? [{ type: 'text', text: mm.content }]
          : contentBlocks(mm.content);
      out.push({ ...mm, content: [...pending, ...own] });
      pending = [];
      pendingTs = undefined;
    } else {
      out.push(mm);
    }
  }
  flush();
  return out;
}

// Tool name → context-aware verb, present while it runs ("Reading") and past
// once done ("Read") — the Notion-style step labels (spec 026). Matched by
// substring so gateway tool aliases (e.g. `memory_search_facts`) still hit;
// first match wins, so specific needles sit above generic ones.
type Verb = { now: () => string; done: () => string };
const V = {
  remember: { now: m.ai_verb_remember, done: m.ai_verbDone_remember },
  lookUp: { now: m.ai_verb_lookUp, done: m.ai_verbDone_lookUp },
  browse: { now: m.ai_verb_browse, done: m.ai_verbDone_browse },
  email: { now: m.ai_verb_email, done: m.ai_verbDone_email },
  calendar: { now: m.ai_verb_calendar, done: m.ai_verbDone_calendar },
  command: { now: m.ai_verb_command, done: m.ai_verbDone_command },
  query: { now: m.ai_verb_query, done: m.ai_verbDone_query },
  search: { now: m.ai_verb_search, done: m.ai_verbDone_search },
  build: { now: m.ai_verb_build, done: m.ai_verbDone_build },
  notify: { now: m.ai_verb_notify, done: m.ai_verbDone_notify },
  read: { now: m.ai_verb_read, done: m.ai_verbDone_read },
  write: { now: m.ai_verb_write, done: m.ai_verbDone_write },
  edit: { now: m.ai_verb_edit, done: m.ai_verbDone_edit },
  coordinate: { now: m.ai_verb_coordinate, done: m.ai_verbDone_coordinate },
  schedule: { now: m.ai_verb_schedule, done: m.ai_verbDone_schedule },
  image: { now: m.ai_verb_image, done: m.ai_verbDone_image },
  sketch: { now: m.ai_verb_sketch, done: m.ai_verbDone_sketch },
} satisfies Record<string, Verb>;
const ACTIVITY_VERBS: Array<[string, Verb]> = [
  ['search_facts', V.remember],
  ['memory', V.remember],
  ['web_search', V.lookUp],
  ['web_fetch', V.lookUp],
  ['browser', V.browse],
  ['gmail', V.email],
  ['email', V.email],
  ['calendar', V.calendar],
  ['booking', V.calendar],
  ['exec', V.command],
  ['bash', V.command],
  ['sandbox', V.build],
  ['chat_artifact', V.build],
  ['notify', V.notify],
  ['query', V.query],
  ['crm', V.query],
  ['find', V.search],
  ['search', V.search],
  ['grep', V.search],
  ['ls', V.search],
  ['read', V.read],
  ['get', V.read],
  ['list', V.read],
  ['write', V.write],
  ['create', V.write],
  ['edit', V.edit],
  ['update', V.edit],
  ['sessions_', V.coordinate],
  ['cron', V.schedule],
  ['image', V.image],
  ['canvas', V.sketch],
];

function verbFor(toolName: string): Verb | null {
  const n = toolName.toLowerCase();
  for (const [needle, verb] of ACTIVITY_VERBS) if (n.includes(needle)) return verb;
  return null;
}

/** "Reading" while the tool runs, "Read" once done; "Using x" / "Used x" when unknown. */
export function toolVerb(toolName: string, done: boolean): string {
  const v = verbFor(toolName);
  if (v) return done ? v.done() : v.now();
  return done ? m.ai_verbDone_use({ tool: toolName }) : m.ai_verb_use({ tool: toolName });
}

/** Context-aware verb for a running tool ("Reading…"), or a generic fallback. */
export function activityVerb(toolName: string): string {
  return `${toolVerb(toolName, false)}…`;
}

/** Whether a message has anything worth rendering (text/thinking/tool/image). */
export function assistantHasContent(m: unknown): boolean {
  if (!m || typeof m !== 'object') return false;
  const content = (m as { content?: unknown }).content;
  if (typeof content === 'string') return content.trim().length > 0;
  return contentBlocks(content).some((b) =>
    [
      'text',
      'thinking',
      'redacted_thinking',
      'tool_use',
      'toolCall',
      'image',
      'image_url',
    ].includes((b?.type as string) ?? ''),
  );
}
