import { describe, expect, it } from 'vitest';
import { pillStatus } from './pill-status';

const user = (text: string) => ({ role: 'user', content: text });
const call = (id: string, name: string) => ({
  role: 'assistant',
  content: [{ type: 'toolCall', id, name, arguments: '{}' }],
});
const result = (id: string) => ({ role: 'toolResult', toolCallId: id, content: 'ok' });
const reply = (text: string) => ({ role: 'assistant', content: [{ type: 'text', text }] });
const idle = { running: false, streamText: '', error: false };
const live = { ...idle, running: true };

describe('pillStatus', () => {
  it('is null for an empty chat so the bubble invites a question', () => {
    expect(pillStatus([], idle)).toBeNull();
  });

  it('thinks before any tool call', () => {
    expect(pillStatus([user('book Ana at 3pm')], live)).toMatchObject({
      task: 'book Ana at 3pm',
      phase: 'thinking',
      toolUses: 0,
    });
  });

  it('names the tool still waiting for its result', () => {
    const s = pillStatus([user('find Ana'), call('a', 'crm_search_contacts')], live);
    expect(s).toMatchObject({ phase: 'tool', tool: 'crm search contacts', toolUses: 1 });
  });

  it('reviews once every call has come back', () => {
    const s = pillStatus([user('find Ana'), call('a', 'crm_search'), result('a')], live);
    expect(s).toMatchObject({ phase: 'reviewing', toolUses: 1 });
  });

  it('is writing while reply text streams', () => {
    expect(pillStatus([user('hi')], { ...live, streamText: 'Hel' })?.phase).toBe('writing');
  });

  it('counts only the latest turn and quotes the finished reply', () => {
    const s = pillStatus(
      [user('old'), call('x', 't'), result('x'), reply('old answer'), user('new'), reply('  Done:\nAna is booked.  ')],
      idle,
    );
    expect(s).toMatchObject({ task: 'new', phase: 'done', toolUses: 0, reply: 'Done: Ana is booked.' });
  });

  it('reports a failed turn', () => {
    expect(pillStatus([user('hi')], { ...idle, error: true })?.phase).toBe('error');
  });

  it('clips long text and applies the display cleanup', () => {
    const s = pillStatus([user(`[ctx] ${'a'.repeat(200)}`)], {
      ...live,
      clean: (t) => t.replace('[ctx] ', ''),
    });
    expect(s?.task).toHaveLength(80);
    expect(s?.task.endsWith('…')).toBe(true);
  });
});
