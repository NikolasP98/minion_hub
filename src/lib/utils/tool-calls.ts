import type { ChatMessage } from '$lib/types/chat';

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  startTs: number;
  endTs: number | null;
  durationMs: number | null;
  result: string | null;
}

export interface Run {
  idx: number;
  userPrompt: string;
  startTs: number;
  endTs: number;
  toolCalls: ToolCall[];
}

type Block = { type: string; [key: string]: unknown };

function isBlockArray(content: unknown): content is Block[] {
  return Array.isArray(content);
}

function extractPrompt(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  if (isBlockArray(content)) {
    return content
      .filter((b) => b.type === 'text')
      .map((b) => (b.text as string) ?? '')
      .join('');
  }
  return '';
}

function hasToolResults(content: ChatMessage['content']): boolean {
  if (!isBlockArray(content)) return false;
  return content.some((b) => b.type === 'tool_result');
}

export function parseToolCallRuns(messages: ChatMessage[]): Run[] {
  const runs: Run[] = [];
  let current: Run | null = null;
  const pending = new Map<string, ToolCall>();

  for (const msg of messages) {
    const ts = msg.timestamp ?? 0;

    if (msg.role === 'user') {
      if (hasToolResults(msg.content)) {
        // Resolve pending tool calls
        const blocks = isBlockArray(msg.content) ? msg.content : [];
        for (const block of blocks) {
          if (block.type === 'tool_result') {
            const tc = pending.get(block.tool_use_id as string);
            if (tc) {
              tc.endTs = ts;
              tc.durationMs = (ts > 0 && tc.startTs > 0) ? ts - tc.startTs : null;
              const c = block.content;
              tc.result = typeof c === 'string' ? c : c != null ? JSON.stringify(c) : null;
              pending.delete(block.tool_use_id as string);
            }
          }
        }
        if (current) current.endTs = ts;
      } else {
        // New run boundary
        if (current && current.toolCalls.length > 0) runs.push(current);
        const prompt = extractPrompt(msg.content).slice(0, 80);
        current = { idx: runs.length + 1, userPrompt: prompt, startTs: ts, endTs: ts, toolCalls: [] };
      }
    } else if (msg.role === 'assistant') {
      if (!current) continue;
      if (isBlockArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_use') {
            const tc: ToolCall = {
              id: block.id as string,
              name: block.name as string,
              input: block.input,
              startTs: ts,
              endTs: null,
              durationMs: null,
              result: null,
            };
            current.toolCalls.push(tc);
            pending.set(tc.id, tc);
          }
        }
      }
      current.endTs = ts;
    }
  }

  if (current && current.toolCalls.length > 0) runs.push(current);
  return runs;
}
