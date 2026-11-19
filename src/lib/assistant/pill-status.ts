import { isToolResultOnly, normalizeBlocks, toolResultsById } from '$lib/chat/blocks';

// What the collapsed assistant pill's hover bubble says about the current
// conversation: the task (last thing the user asked) plus one live status line.
// Pure so the component only maps `phase` to copy.

export type PillPhase = 'thinking' | 'tool' | 'reviewing' | 'writing' | 'done' | 'error';

export interface PillStatus {
  /** The user's latest request, clipped; '' when the run has no user turn yet. */
  task: string;
  phase: PillPhase;
  /** Human-readable name of the tool running right now (phase 'tool'). */
  tool?: string;
  /** Tool calls made since the latest user turn. */
  toolUses: number;
  /** Start of the finished reply (phase 'done'). */
  reply?: string;
}

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const textOf = (m: unknown) =>
  normalizeBlocks((m as { content?: unknown }).content)
    .flatMap((b) => (b.kind === 'text' ? [b.text] : []))
    .join(' ');

const isUser = (m: unknown) => (m as { role?: string }).role === 'user' && !isToolResultOnly(m);

/** `null` = nothing said yet; the bubble shows the "Ask anything" invitation. */
export function pillStatus(
  messages: readonly unknown[],
  o: {
    running: boolean;
    streamText: string;
    error: boolean;
    /** Display cleanup for message text (page-context prefixes, TTS tags, UI fences). */
    clean?: (text: string) => string;
  },
): PillStatus | null {
  const clean = o.clean ?? ((t: string) => t);
  const userAt = messages.findLastIndex(isUser);
  if (userAt < 0 && !o.running) return null;

  const turn = messages.slice(userAt + 1);
  const results = toolResultsById(turn);
  const blocks = turn
    .filter((m) => !isToolResultOnly(m))
    .flatMap((m) => normalizeBlocks((m as { content?: unknown }).content));
  const tools = blocks.filter((b) => b.kind === 'tool');
  const last = blocks.at(-1);
  const base = {
    task: userAt >= 0 ? clip(clean(textOf(messages[userAt])), 80) : '',
    toolUses: tools.length,
  };

  if (o.running) {
    if (o.streamText.trim()) return { ...base, phase: 'writing' };
    if (last?.kind === 'tool' && !results[last.id])
      // TODO(handoff): raw tool id made readable ('crm search contacts'), not a
      // localized human label — needs a label per tool from the gateway tool
      // catalog. Meta proposals/2026-11-14-hub-assistant-pill-status-followups.md.
      return { ...base, phase: 'tool', tool: last.name.replace(/[_.-]+/g, ' ') };
    // A thought after a tool call is the model reading what came back.
    return { ...base, phase: tools.length ? 'reviewing' : 'thinking' };
  }
  if (o.error) return { ...base, phase: 'error' };
  const reply =
    turn
      .filter((m) => !isUser(m) && !isToolResultOnly(m))
      .map(textOf)
      .filter((t) => t.trim())
      .at(-1) ?? '';
  return { ...base, phase: 'done', reply: clip(clean(reply), 120) };
}
