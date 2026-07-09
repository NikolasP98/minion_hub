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
				input: t === 'toolCall' ? b.arguments : b.input
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
					isError: !!b.is_error
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
export function isToolResultOnly(m: unknown): boolean {
	if (!m || typeof m !== 'object') return false;
	const mm = m as { role?: string; content?: unknown };
	if (mm.role === 'toolResult') return true;
	const blocks = contentBlocks(mm.content);
	return blocks.length > 0 && blocks.every((b) => b?.type === 'tool_result');
}

// Tool name → context-aware activity verb for the live status line. Matched by
// substring so gateway tool aliases (e.g. `memory_search_facts`) still hit.
const ACTIVITY_VERBS: Array<[string, string]> = [
	['search_facts', 'Remembering…'],
	['memory', 'Remembering…'],
	['web_search', 'Looking up…'],
	['web_fetch', 'Looking up…'],
	['browser', 'Browsing…'],
	['gmail', 'Checking email…'],
	['email', 'Checking email…'],
	['calendar', 'Checking the calendar…'],
	['exec', 'Running a command…'],
	['bash', 'Running a command…'],
	['read', 'Reading…'],
	['write', 'Writing…'],
	['edit', 'Editing…'],
	['grep', 'Investigating…'],
	['find', 'Investigating…'],
	['ls', 'Investigating…'],
	['sessions_', 'Coordinating…'],
	['cron', 'Scheduling…'],
	['image', 'Looking at an image…'],
	['canvas', 'Sketching…'],
];

/** Context-aware verb for a running tool ("Reading…"), or a generic fallback. */
export function activityVerb(toolName: string): string {
	const n = toolName.toLowerCase();
	for (const [needle, verb] of ACTIVITY_VERBS) {
		if (n.includes(needle)) return verb;
	}
	return `Using ${toolName}…`;
}

/** Whether a message has anything worth rendering (text/thinking/tool/image). */
export function assistantHasContent(m: unknown): boolean {
	if (!m || typeof m !== 'object') return false;
	const content = (m as { content?: unknown }).content;
	if (typeof content === 'string') return content.trim().length > 0;
	return contentBlocks(content).some((b) =>
		['text', 'thinking', 'redacted_thinking', 'tool_use', 'toolCall', 'image', 'image_url'].includes(
			(b?.type as string) ?? ''
		)
	);
}
