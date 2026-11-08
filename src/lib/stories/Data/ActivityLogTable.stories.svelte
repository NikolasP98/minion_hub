<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import ActivityLogTable from '$lib/components/reliability/ActivityLogTable.svelte';
  import type { ReliabilityEvent } from '$lib/state/reliability/types';

  const CATEGORIES = ['gateway', 'agent', 'tool', 'message', 'channel', 'crash', 'cron', 'memory'];
  const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical', 'ok'];
  const MESSAGES = [
    'Session started',
    'Tool call exceeded the 30 s budget and was retried once before succeeding',
    'Heartbeat missed',
    'Agent switched model to the fallback provider after three consecutive 529 responses from the primary endpoint',
    'Channel reconnected',
    'Memory compaction finished',
  ];
  const BASE = Date.UTC(2026, 10, 8, 9, 0, 0);

  function makeEvents(n: number): ReliabilityEvent[] {
    return Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      category: CATEGORIES[i % CATEGORIES.length],
      severity: SEVERITIES[(i * 7) % SEVERITIES.length],
      event: `${CATEGORIES[i % CATEGORIES.length]}.${['start', 'stop', 'retry', 'error'][i % 4]}`,
      message: MESSAGES[i % MESSAGES.length],
      agentId: i % 3 === 0 ? 'main' : i % 3 === 1 ? 'support-bot' : undefined,
      correlationId: i % 5 === 0 ? `corr-${(i * 31) % 997}` : undefined,
      metadata:
        i % 2 === 0
          ? { durationMs: (i * 137) % 9000, attempt: (i % 3) + 1, provider: 'anthropic' }
          : undefined,
      timestamp: BASE - i * 37_000,
    }));
  }

  const events = makeEvents(40);

  const { Story } = defineMeta({
    title: 'Data/ActivityLogTable',
    component: ActivityLogTable,
    tags: ['autodocs'],
    argTypes: { searchable: { control: 'boolean' }, showTimeline: { control: 'boolean' } },
    args: { events, searchable: true, showTimeline: false, onTimelineClick: fn() },
  });
</script>

<Story name="Populated">
  {#snippet template(args)}
    <div style="height: 32rem; display: flex; flex-direction: column"><ActivityLogTable {...args} /></div>
  {/snippet}
</Story>

<Story name="WithCategoryTabs" args={{ categories: ['all', ...CATEGORIES] }}>
  {#snippet template(args)}
    <div style="height: 32rem; display: flex; flex-direction: column"><ActivityLogTable {...args} /></div>
  {/snippet}
</Story>

<Story name="WithTimeline" args={{ showTimeline: true, categories: ['all', ...CATEGORIES] }}>
  {#snippet template(args)}
    <div style="height: 40rem; display: flex; flex-direction: column"><ActivityLogTable {...args} /></div>
  {/snippet}
</Story>

<Story name="Truncated" args={{ total: 12840, byCategory: { gateway: 4000, agent: 3100, tool: 2200, crash: 12 }, categories: ['all', 'gateway', 'agent', 'tool', 'crash'] }}>
  {#snippet template(args)}
    <div style="height: 32rem; display: flex; flex-direction: column"><ActivityLogTable {...args} /></div>
  {/snippet}
</Story>

<Story name="ManyRows" args={{ events: makeEvents(500) }}>
  {#snippet template(args)}
    <div style="height: 32rem; display: flex; flex-direction: column"><ActivityLogTable {...args} /></div>
  {/snippet}
</Story>

<Story name="CustomTitleNoSearch" args={{ title: 'Agent activity', searchable: false }}>
  {#snippet template(args)}
    <div style="height: 32rem; display: flex; flex-direction: column"><ActivityLogTable {...args} /></div>
  {/snippet}
</Story>

<Story name="Empty" args={{ events: [], emptyMessage: 'No events in this range.' }}>
  {#snippet template(args)}
    <div style="height: 32rem; display: flex; flex-direction: column"><ActivityLogTable {...args} /></div>
  {/snippet}
</Story>
