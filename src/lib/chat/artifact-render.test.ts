import { describe, expect, it, vi } from 'vitest';
vi.mock('$lib/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://x/en/home'), data: {} } }));
import { render } from 'svelte/server';
import ChatBlocks from './ChatBlocks.svelte';

// The exact chat_artifact call DeepSeek made in prod (2026-09-02 19:41): flat
// buttons, empty html. Must render as a buttons-only card whether the gateway
// hands `arguments` over as an object or as a JSON string.
const args = {
  buttons: [
    { callback_data: 'SHOW_ME_HOW', text: 'Enséñame cómo' },
    { callback_data: 'DO_IT_FOR_ME', text: 'Hazlo por mí' },
  ],
  html: '',
};
const msg = (a: unknown) => ({
  role: 'assistant',
  content: [
    { type: 'thinking', thinking: 'x' },
    { type: 'toolCall', id: 'call_1', name: 'chat_artifact', arguments: a },
  ],
});

describe('chat_artifact rendering', () => {
  it.each([
    ['object arguments', args],
    ['string arguments', JSON.stringify(args)],
  ])('renders buttons with %s and no empty frame', (_label, a) => {
    const { body } = render(ChatBlocks, {
      props: { message: msg(a), compact: true, onArtifactCallback: () => {} },
    });
    expect(body).toContain('Enséñame cómo');
    expect(body).toContain('Hazlo por mí');
    expect(body).not.toContain('artifact-error');
    expect(body).not.toContain('artifact-frame');
  });
});
