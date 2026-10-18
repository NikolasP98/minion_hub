import { mount } from 'svelte';
import MarkdownMessage from '../../../src/lib/components/chat/MarkdownMessage.svelte';
import { registerGlobalTools } from '../../../src/lib/assistant/global-tools';
import { runUiCalls } from '../../../src/lib/assistant/runner';
import type { ModelContextTool } from '../../../src/lib/assistant/model-context';
import { navigations } from './navigation';
import { revoke } from './access';
import './fixture.css';

const tools: ModelContextTool[] = [];
Object.defineProperty(document, 'modelContext', {
  value: { registerTool: (tool: ModelContextTool) => tools.push(tool) },
});
registerGlobalTools();
const input = { path: '/pos/catalog', params: { q: 'QA & formula' } };
const calls = [
  { tool: 'fill_test', input: {} },
  { tool: 'hub.navigate', input },
  { tool: 'ui.guide', input: {} },
];
const value =
  'The most expensive seeded product is **QA Formula Margin**, **S/ 100.00**.\n\n```minion-ui\n' +
  JSON.stringify(calls) +
  '\n```';
mount(MarkdownMessage, { target: document.querySelector('#app')!, props: { value } });
const fixture = {
  navigations,
  revoke,
  legacy: () => runUiCalls(calls),
  native: () =>
    tools
      .find((tool) => tool.name === 'hub.navigate')!
      .execute(input, { signal: new AbortController().signal }),
};
Object.assign(window, { navigationFixture: fixture });
