<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import DreamActivity from '$lib/components/agents/DreamActivity.svelte';
  import { dreamState, type DreamData } from '$lib/state/features/dream-data.svelte';

  const data: DreamData = {
    state: {
      lastConsolidatedAt: Date.now() - 30 * 3_600_000,
      lastSessionScanAt: Date.now() - 6 * 60_000,
    },
    pendingNotes: 4,
    history: [
      {
        timestamp: '2026-11-07 03:12',
        content:
          'Consolidated 9 daily notes. Learned: the owner prefers WhatsApp confirmations before 9 am; Tuesday is the busiest booking day; two suppliers now invoice in USD.',
      },
      {
        timestamp: '2026-10-31 03:10',
        content:
          'Consolidated 7 daily notes. Archived the October price list; the new one applies from 1 Nov.',
      },
      {
        timestamp: '2026-10-24 03:09',
        content:
          'Consolidated 8 daily notes.\nNo new long-term facts; three reminders were marked obsolete.',
      },
    ],
  };

  // The component loads via the gateway on mount (fails here); seed the store afterwards.
  const seed = (patch?: Partial<typeof dreamState>) => async () => {
    Object.assign(dreamState, { agentId: 'panik', data: null, loading: false, error: null }, patch);
  };

  const { Story } = defineMeta({
    title: 'Components/Agents/DreamActivity',
    component: DreamActivity,
    tags: ['autodocs'],
    args: { agentId: 'panik' },
  });
</script>

<Story name="Populated" play={seed({ data })}>
  {#snippet template(args)}<div class="w-[36rem]"><DreamActivity {...args} /></div>{/snippet}
</Story>

<Story
  name="No history yet"
  play={seed({
    data: {
      ...data,
      history: [],
      pendingNotes: 0,
      state: { lastConsolidatedAt: null, lastSessionScanAt: null },
    },
  })}
>
  {#snippet template(args)}<div class="w-[36rem]"><DreamActivity {...args} /></div>{/snippet}
</Story>

<Story name="Loading" play={seed({ loading: true })}>
  {#snippet template(args)}<div class="w-[36rem]"><DreamActivity {...args} /></div>{/snippet}
</Story>

<Story name="Error" play={seed({ error: 'dream.history: not connected' })}>
  {#snippet template(args)}<div class="w-[36rem]"><DreamActivity {...args} /></div>{/snippet}
</Story>

<Story name="No data" play={seed()}>
  {#snippet template(args)}<div class="w-[36rem]"><DreamActivity {...args} /></div>{/snippet}
</Story>
