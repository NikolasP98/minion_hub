import { describe, expect, it, vi } from 'vitest';
import { registerTools } from './model-context';
import { runAssistantUiCalls } from './dispatch';
import { sendAssistantTurn } from '$lib/services/gateway/chat-rpc';
vi.mock('$lib/services/gateway/chat-rpc', () => ({ sendAssistantTurn: vi.fn() }));

describe('navigation reply dispatch', () => {
  it('duplicate live replies and silent follow-up replies cannot start another turn', async () => {
    const read = vi.fn(() => ({ data: 1 }));
    const off = registerTools([
      {
        name: 'hub.navigate',
        description: '',
        inputSchema: {},
        execute: () => ({ error: 'invalid path' }),
      },
      {
        name: 'test.read',
        description: '',
        inputSchema: {},
        execute: read,
        annotations: { readOnlyHint: true },
      },
    ]);
    const text =
      '```minion-ui\n' +
      JSON.stringify([
        { tool: 'test.read', input: {} },
        { tool: 'hub.navigate', input: { path: '/bad' } },
      ]) +
      '\n```';
    try {
      for (let i = 0; i < 3; i++) await runAssistantUiCalls('test', text, 'agent:test:main');
      expect(sendAssistantTurn).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
    } finally {
      off();
    }
  });
});
