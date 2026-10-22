import { mount } from 'svelte';
import ChatTurn from '../../../src/lib/components/my-agent/ChatTurn.svelte';
import ChatMessage from '../../../src/lib/components/chat/ChatMessage.svelte';
import MarkdownMessage from '../../../src/lib/components/chat/MarkdownMessage.svelte';
import { setLanguageTag } from '../../../src/lib/paraglide/runtime';
import { navigations } from './seams';
import './fixture.css';
const language = new URL(location.href).searchParams.get('lang') === 'es' ? 'es' : 'en';
setLanguageTag(language);
document.documentElement.lang = language;
const marker = '[chat.history omitted: message too large]';
const history = {
  role: 'assistant' as const,
  content: [{ type: 'text', text: marker }],
  timestamp: 123456789,
  __openclaw: { truncated: true, reason: 'oversized' },
};
const original = JSON.stringify(history);
mount(ChatTurn, { target: document.querySelector('#assistant')!, props: { message: history } });
mount(ChatMessage, {
  target: document.querySelector('#user')!,
  props: { message: { role: 'user', content: marker, timestamp: 123456789 } },
});
mount(ChatTurn, {
  target: document.querySelector('#stream')!,
  props: { message: history, textOverride: marker },
});
mount(MarkdownMessage, {
  target: document.querySelector('#answer')!,
  props: {
    value:
      'Highest-price seeded services:\n\n- QA Service A — S/2,000\n- QA Service B — S/2,000\n- QA Service C — S/2,000\n\n[Product catalog](/pos/catalog)',
  },
});
Object.assign(window, {
  historyFixture: {
    navigations,
    language,
    storedMessageUnchanged: () => JSON.stringify(history) === original,
  },
});
