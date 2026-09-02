/**
 * Wire format between the gateway model and the in-page tool registry.
 *
 * The gateway's chat.send carries plain text only, so the model invokes page
 * tools by emitting fenced blocks:
 *
 *     ```minion-ui
 *     {"tool":"hub.navigate","input":{"path":"/stock/entries","params":{"new":1}}}
 *     ```
 *
 * One JSON object per fence, several fences per reply allowed, executed in
 * order. The fences are stripped from what the user sees (MarkdownMessage)
 * and replaced by action chips.
 *
 * TODO(handoff): prompt-driven protocol instead of native tool_use — replace
 * with gateway client-tools (chat.send `clientTools` + ui.tool.request/result)
 * per meta proposal 2026-09-02-gateway-client-tools-webmcp-bridge; this file,
 * runner.ts follow-ups and the envelope tool section go away with it.
 */

export interface UiCall {
  tool: string;
  input: Record<string, unknown>;
}

export const UI_FENCE = 'minion-ui';

// Tolerates CRLF, trailing spaces after the info string, and an unterminated
// fence at the very end (streaming: hide the half-typed block, not show it).
const FENCE_RE = /```minion-ui[ \t]*\r?\n([\s\S]*?)(?:\r?\n```|$)/g;

export function parseUiBlocks(text: string): { calls: UiCall[]; text: string } {
  const calls: UiCall[] = [];
  const clean = text
    .replace(FENCE_RE, (_m, body: string) => {
      for (const c of parseBody(body)) calls.push(c);
      return '';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { calls, text: clean };
}

function parseBody(body: string): UiCall[] {
  const t = body.trim();
  if (!t) return [];
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };
  let v = tryParse(t);
  // Some models emit one object per line instead of an array.
  if (v === undefined)
    v = t
      .split(/\r?\n/)
      .map((l) => tryParse(l))
      .filter(Boolean);
  const list = Array.isArray(v) ? v : [v];
  return list.filter(isUiCall).map((c) => ({ tool: c.tool, input: c.input ?? {} }));
}

function isUiCall(v: unknown): v is { tool: string; input?: Record<string, unknown> } {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as { tool?: unknown }).tool === 'string' &&
    (v as { tool: string }).tool.length > 0 &&
    ((v as { input?: unknown }).input === undefined ||
      (typeof (v as { input?: unknown }).input === 'object' &&
        (v as { input: unknown }).input !== null))
  );
}

/** Display-only: drop the fences, keep the prose. */
export function stripUiBlocks(text: string): string {
  return parseUiBlocks(text).text;
}
