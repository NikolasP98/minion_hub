// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import ChatTurn from '$lib/components/my-agent/ChatTurn.svelte';
import ChatMessage from '$lib/components/chat/ChatMessage.svelte';
import { extractText } from '$lib/utils/text';
import { setLanguageTag } from '$lib/paraglide/runtime';

vi.mock('$lib/state/agents/tool-catalog.svelte', () => ({
  toolCatalog: { byId: {} },
  ensureToolCatalogLoaded: vi.fn(),
}));
vi.mock('$lib/state/features/aliases.svelte', () => ({
  useAliasDirectory: vi.fn(),
  getAliases: () => ({}),
}));
const marker = '[chat.history omitted: message too large]';
const notice = {
  en: 'This earlier message is too large to display here.',
  es: 'Este mensaje anterior es demasiado grande para mostrarlo aquí.',
};
afterEach(() => {
  cleanup();
  setLanguageTag('en');
});

describe('oversized history display across actual chat consumers', () => {
  it.each(['en', 'es'] as const)(
    'localizes structured assistant history in both shared surfaces: %s',
    (lang) => {
      setLanguageTag(lang);
      const message = {
        role: 'assistant' as const,
        timestamp: 123456789,
        content: [{ type: 'text', text: marker }],
        __openclaw: { truncated: true, reason: 'oversized' },
      };
      const original = JSON.stringify(message);
      for (const component of [ChatTurn, ChatMessage]) {
        const view = render(component, { message });
        expect(view.container.textContent).toContain(notice[lang]);
        expect(view.container.textContent).not.toContain(marker);
        view.unmount();
      }
      expect(JSON.stringify(message)).toBe(original);
    },
  );
  it('localizes user history and plain-text legacy cached history without changing stored content', () => {
    const message = { role: 'user', content: marker, timestamp: 123456789 };
    const view = render(ChatMessage, { message });
    expect(view.container.textContent).toContain(notice.en);
    expect(extractText(message)).toBe(notice.en);
    expect(message.content).toBe(marker);
  });
  it('does not let a streaming text override restore a raw history marker', () => {
    const view = render(ChatTurn, {
      message: { role: 'assistant', content: marker },
      textOverride: marker,
    });
    expect(view.container.textContent).toContain(notice.en);
    expect(view.container.textContent).not.toContain(marker);
  });
  it.each(['A fresh real reply.', ''])(
    'preserves explicit real or empty streaming overrides: %j',
    (textOverride) => {
      const view = render(ChatTurn, {
        message: { role: 'assistant', content: marker },
        textOverride,
      });
      expect(view.container.textContent).not.toContain(notice.en);
      expect(view.container.textContent).not.toContain(marker);
      if (textOverride) expect(view.container.textContent).toContain(textOverride);
    },
  );
  it.each([
    `The log says ${marker}; this is an explanation.`,
    `\`${marker}\``,
    `\n\`\`\`text\n${marker}\n\`\`\``,
  ])('preserves genuine prose and quoted protocol examples: %s', (text) => {
    const message = { role: 'assistant' as const, content: text };
    const view = render(ChatTurn, { message });
    expect(view.container.textContent).toContain(marker);
    expect(view.container.textContent).not.toContain(notice.en);
    expect(extractText(message)).toBe(text.trim());
  });
  it('does not reinterpret contradictory metadata as an oversized message', () => {
    const message = {
      role: 'assistant' as const,
      content: marker,
      __openclaw: { truncated: false, reason: 'other' },
    };
    const view = render(ChatTurn, { message });
    expect(view.container.textContent).toContain(marker);
    expect(extractText(message)).toBe(marker);
  });
  it('preserves real content and mixed blocks even if truncation metadata is present', () => {
    const content = [
      { type: 'text', text: marker },
      { type: 'text', text: 'Keep this real explanation.' },
    ];
    const message = {
      role: 'assistant' as const,
      content,
      __openclaw: { truncated: true, reason: 'oversized' },
    };
    const view = render(ChatTurn, { message });
    expect(view.container.textContent).toContain('Keep this real explanation.');
    expect(view.container.textContent).not.toContain(notice.en);
  });
});
