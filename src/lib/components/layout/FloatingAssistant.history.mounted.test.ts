// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { page } from '$app/state';
import { assistant } from '$lib/state/features/assistant.svelte';
import { agentChat } from '$lib/state/chat/chat.svelte';
import { setLanguageTag } from '$lib/paraglide/runtime';
import FloatingAssistant from './FloatingAssistant.svelte';

vi.mock('$lib/services/gateway.svelte', () => ({
  sendAssistantTurn: vi.fn(),
  abortChat: vi.fn(),
  loadChatHistory: vi.fn(),
  cleanInboundForDisplay: (text: string) => text,
  isActionToken: () => false,
  resetChat: vi.fn(),
}));
vi.mock('$lib/state/features/voice-call.svelte', () => ({
  voiceCall: { active: false, status: 'idle' },
  mouth: { open: 0 },
  toggleMute: vi.fn(),
  endCall: vi.fn(),
}));
vi.mock('$lib/state/agents/tool-catalog.svelte', () => ({
  toolCatalog: { byId: {} },
  ensureToolCatalogLoaded: vi.fn(),
}));
vi.mock('$lib/state/features/aliases.svelte', () => ({
  useAliasDirectory: vi.fn(),
  getAliases: () => ({}),
}));
const marker = '[chat.history omitted: message too large]';
afterEach(() => {
  cleanup();
  assistant.open = false;
  delete agentChat['history-fixture'];
  page.data = {};
  setLanguageTag('en');
});
describe('Floating Assistant history rendering', () => {
  it.each(['en', 'es'] as const)(
    'localizes an omission after tool-only history without changing the source: %s',
    async (lang) => {
      setLanguageTag(lang);
      page.url.pathname = '/settings';
      page.data = { personalAgent: { agent: { agentId: 'history-fixture' } } };
      assistant.open = true;
      const messages = [
        {
          role: 'assistant' as const,
          content: [{ type: 'toolCall', id: 'a', name: 'catalog_query', arguments: '{}' }],
        },
        {
          role: 'assistant' as const,
          content: [{ type: 'text', text: marker }],
          __openclaw: { truncated: true, reason: 'oversized' },
        },
        {
          role: 'assistant' as const,
          content: 'QA Service A, QA Service B, QA Service C. [Catalog](/pos/catalog)',
        },
      ];
      agentChat['history-fixture'] = {
        messages,
        sessionKey: 'agent:history-fixture:main',
        stream: null,
        streamMessage: null,
        streamDisplay: '',
        runId: null,
        sending: false,
        loading: false,
        inputText: '',
        lastError: null,
        liveTools: [],
        liveActivity: null,
      };
      const original = JSON.stringify(agentChat['history-fixture'].messages);
      const view = render(FloatingAssistant);
      await vi.waitFor(() => expect(view.baseElement.textContent).toContain('QA Service A'));
      expect(view.baseElement.textContent).not.toContain(marker);
      expect(view.baseElement.textContent).toContain(
        lang === 'en'
          ? 'This earlier message is too large to display here.'
          : 'Este mensaje anterior es demasiado grande para mostrarlo aquí.',
      );
      expect(view.baseElement.querySelector('a[href="/pos/catalog"]')).not.toBeNull();
      expect(JSON.stringify(agentChat['history-fixture'].messages)).toBe(original);
    },
  );
  it.each([
    { label: 'legacy', envelope: null, stream: marker, localized: true },
    {
      label: 'structured',
      envelope: {
        role: 'assistant' as const,
        content: marker,
        __openclaw: { truncated: true, reason: 'oversized' },
      },
      stream: marker,
      localized: true,
    },
    {
      label: 'contradictory',
      envelope: {
        role: 'assistant' as const,
        content: marker,
        __openclaw: { truncated: false, reason: 'other' },
      },
      stream: marker,
      localized: false,
    },
    {
      label: 'mixed',
      envelope: {
        role: 'assistant' as const,
        content: [
          { type: 'toolCall', id: 'a', name: 'query' },
          { type: 'text', text: marker },
        ],
      },
      stream: marker,
      localized: false,
    },
    {
      label: 'fresh override',
      envelope: { role: 'assistant' as const, content: marker },
      stream: 'Fresh streamed reply.',
      localized: false,
    },
    {
      label: 'empty override',
      envelope: { role: 'assistant' as const, content: marker },
      stream: '',
      localized: false,
    },
  ])('preserves streaming provenance: $label', async ({ envelope, stream, localized }) => {
    page.url.pathname = '/settings';
    page.data = { personalAgent: { agent: { agentId: 'history-fixture' } } };
    assistant.open = true;
    agentChat['history-fixture'] = {
      messages: [],
      sessionKey: 'agent:history-fixture:main',
      stream,
      streamMessage: envelope,
      streamDisplay: '',
      runId: 'qa',
      sending: false,
      loading: false,
      inputText: '',
      lastError: null,
      liveTools: [],
      liveActivity: null,
    };
    const original = JSON.stringify(agentChat['history-fixture']);
    const view = render(FloatingAssistant);
    const notice = 'This earlier message is too large to display here.';
    await vi.waitFor(() => expect(view.baseElement.querySelector('.fa-root')).not.toBeNull());
    if (localized) {
      expect(view.baseElement.textContent).toContain(notice);
      expect(view.baseElement.textContent).not.toContain(marker);
    } else {
      expect(view.baseElement.textContent).not.toContain(notice);
      if (stream) expect(view.baseElement.textContent).toContain(stream);
    }
    expect(JSON.stringify(agentChat['history-fixture'])).toBe(original);
  });
});
