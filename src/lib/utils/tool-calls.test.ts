import { describe, it, expect } from 'vitest';
import { parseToolCallRuns } from './tool-calls';
import type { ChatMessage } from '$lib/types/chat';

// Helper to build a minimal ChatMessage
function msg(role: 'user' | 'assistant', content: ChatMessage['content'], timestamp: number): ChatMessage {
  return { role, content, timestamp };
}

describe('parseToolCallRuns', () => {
  it('returns empty array for empty messages', () => {
    expect(parseToolCallRuns([])).toEqual([]);
  });

  it('returns empty array when no tool calls exist', () => {
    const messages: ChatMessage[] = [
      msg('user', 'hello', 1000),
      msg('assistant', 'hi there', 2000),
    ];
    expect(parseToolCallRuns(messages)).toEqual([]);
  });

  it('parses a single run with one tool call', () => {
    const messages: ChatMessage[] = [
      msg('user', 'do something', 1000),
      msg('assistant', [
        { type: 'text', text: 'Sure' },
        { type: 'tool_use', id: 'toolu_1', name: 'bash', input: { command: 'ls' } },
      ], 2000),
      msg('user', [
        { type: 'tool_result', tool_use_id: 'toolu_1', content: 'file1\nfile2' },
      ], 3000),
      msg('assistant', 'Done', 4000),
    ];

    const runs = parseToolCallRuns(messages);
    expect(runs).toHaveLength(1);
    expect(runs[0].idx).toBe(1);
    expect(runs[0].userPrompt).toBe('do something');
    expect(runs[0].startTs).toBe(1000);
    expect(runs[0].endTs).toBe(4000);
    expect(runs[0].toolCalls).toHaveLength(1);

    const tc = runs[0].toolCalls[0];
    expect(tc.id).toBe('toolu_1');
    expect(tc.name).toBe('bash');
    expect(tc.startTs).toBe(2000);
    expect(tc.endTs).toBe(3000);
    expect(tc.durationMs).toBe(1000);
    expect(tc.result).toBe('file1\nfile2');
  });

  it('parses multiple tool calls in one assistant turn', () => {
    const messages: ChatMessage[] = [
      msg('user', 'do two things', 1000),
      msg('assistant', [
        { type: 'tool_use', id: 'tc_a', name: 'read_file', input: { path: 'a.txt' } },
        { type: 'tool_use', id: 'tc_b', name: 'bash', input: { command: 'pwd' } },
      ], 2000),
      msg('user', [
        { type: 'tool_result', tool_use_id: 'tc_a', content: 'content a' },
        { type: 'tool_result', tool_use_id: 'tc_b', content: '/home' },
      ], 3500),
    ];

    const runs = parseToolCallRuns(messages);
    expect(runs).toHaveLength(1);
    expect(runs[0].toolCalls).toHaveLength(2);
    expect(runs[0].toolCalls[0].durationMs).toBe(1500);
    expect(runs[0].toolCalls[1].durationMs).toBe(1500);
  });

  it('creates separate runs for separate user messages', () => {
    const messages: ChatMessage[] = [
      msg('user', 'first task', 1000),
      msg('assistant', [
        { type: 'tool_use', id: 'tc_1', name: 'bash', input: {} },
      ], 2000),
      msg('user', [{ type: 'tool_result', tool_use_id: 'tc_1', content: '' }], 3000),
      msg('assistant', 'done', 4000),
      msg('user', 'second task', 5000),
      msg('assistant', [
        { type: 'tool_use', id: 'tc_2', name: 'write_file', input: {} },
      ], 6000),
      msg('user', [{ type: 'tool_result', tool_use_id: 'tc_2', content: '' }], 7000),
      msg('assistant', 'done 2', 8000),
    ];

    const runs = parseToolCallRuns(messages);
    expect(runs).toHaveLength(2);
    expect(runs[0].idx).toBe(1);
    expect(runs[0].userPrompt).toBe('first task');
    expect(runs[1].idx).toBe(2);
    expect(runs[1].userPrompt).toBe('second task');
  });

  it('handles tool call with no matching result (endTs null)', () => {
    const messages: ChatMessage[] = [
      msg('user', 'run this', 1000),
      msg('assistant', [
        { type: 'tool_use', id: 'tc_orphan', name: 'bash', input: {} },
      ], 2000),
      // No tool_result follows
      msg('assistant', 'partial response', 3000),
    ];

    const runs = parseToolCallRuns(messages);
    expect(runs).toHaveLength(1);
    const tc = runs[0].toolCalls[0];
    expect(tc.endTs).toBeNull();
    expect(tc.durationMs).toBeNull();
  });

  it('truncates long user prompts to 80 chars', () => {
    const longMsg = 'x'.repeat(120);
    const messages: ChatMessage[] = [
      msg('user', longMsg, 1000),
      msg('assistant', [
        { type: 'tool_use', id: 'tc_1', name: 'bash', input: {} },
      ], 2000),
    ];

    const runs = parseToolCallRuns(messages);
    expect(runs[0].userPrompt.length).toBeLessThanOrEqual(80);
  });

  it('extracts user prompt from content block arrays', () => {
    const messages: ChatMessage[] = [
      msg('user', [{ type: 'text', text: 'do the thing' }], 1000),
      msg('assistant', [
        { type: 'tool_use', id: 'tc_1', name: 'bash', input: {} },
      ], 2000),
    ];

    const runs = parseToolCallRuns(messages);
    expect(runs[0].userPrompt).toBe('do the thing');
  });
});
