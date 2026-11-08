<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import SessionMonitor from '$lib/components/sessions/SessionMonitor.svelte';
  import { agentChat, ensureAgentChat } from '$lib/state/chat/chat.svelte';

  const AGENT = 'panik';
  const MAIN = `agent:${AGENT}:main`;
  const t0 = Date.now() - 90_000;
  const use = (id, name, input) => ({ type: 'tool_use', id, name, input });
  const result = (id, content) => ({ type: 'tool_result', tool_use_id: id, content });
  const completedRun = [
    { role: 'user', content: 'Find last week’s invoices and total them', timestamp: t0 },
    { role: 'assistant', content: [{ type: 'text', text: 'Searching…' }, use('tu1', 'search_invoices', { range: 'last_week' })], timestamp: t0 + 1_200 },
    { role: 'user', content: [result('tu1', '[12 invoices]')], timestamp: t0 + 4_100 },
    { role: 'assistant', content: [use('tu2', 'bash', { cmd: 'sum amounts' }), use('tu3', 'read_file', { path: 'rates.json' })], timestamp: t0 + 4_500 },
    { role: 'user', content: [result('tu2', 'S/ 4,812.30'), result('tu3', '{"igv":0.18}')], timestamp: t0 + 9_800 },
    { role: 'assistant', content: [use('tu4', 'web_search', { q: 'tipo de cambio SUNAT' })], timestamp: t0 + 10_000 },
    { role: 'user', content: [result('tu4', 'x'.repeat(4000))], timestamp: t0 + 18_000 },
    { role: 'assistant', content: [{ type: 'text', text: 'Total: S/ 4,812.30' }], timestamp: t0 + 19_000 },
  ];
  const runningRun = [
    { role: 'user', content: 'Reconcile the cash drawer', timestamp: t0 + 60_000 },
    { role: 'assistant', content: [use('tu9', 'mcp__supabase__execute_sql', { sql: 'select…' })], timestamp: t0 + 61_000 },
  ];

  // The main session reads agentChat; any other key is fetched (fails here → error state).
  const seed = (messages) => async () => {
    delete agentChat[AGENT];
    ensureAgentChat(AGENT).messages = messages;
  };

  const { Story } = defineMeta({
    title: 'Sessions/SessionMonitor',
    component: SessionMonitor,
    tags: ['autodocs'],
    args: { agentId: AGENT, sessionKey: MAIN, serverId: null },
  });
</script>

<Story name="No session selected" args={{ sessionKey: null }} play={seed([])}>
  {#snippet template(args)}<div class="w-[36rem] h-96"><SessionMonitor {...args} /></div>{/snippet}
</Story>

<Story name="Completed run with tool uses" play={seed(completedRun)}>
  {#snippet template(args)}<div class="w-[36rem] h-96"><SessionMonitor {...args} /></div>{/snippet}
</Story>

<Story name="Running with pending tool" play={seed([...completedRun, ...runningRun])}>
  {#snippet template(args)}<div class="w-[36rem] h-96"><SessionMonitor {...args} /></div>{/snippet}
</Story>

<Story name="No tool calls" play={seed([{ role: 'user', content: 'hi', timestamp: t0 }, { role: 'assistant', content: 'Hello', timestamp: t0 + 500 }])}>
  {#snippet template(args)}<div class="w-[36rem] h-96"><SessionMonitor {...args} /></div>{/snippet}
</Story>

<Story name="Other session fetch fails" args={{ sessionKey: `agent:${AGENT}:whatsapp:dm:+51999888777` }} play={seed([])}>
  {#snippet template(args)}<div class="w-[36rem] h-96"><SessionMonitor {...args} /></div>{/snippet}
</Story>
