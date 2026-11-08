<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import AiConversation from '$lib/components/ai/AiConversation.svelte';
  import AiMessage from '$lib/components/ai/AiMessage.svelte';
  import { Button } from '$lib/components/ui';

  const LINES = [
    'What do I have next week?',
    'Three bookings next week: Tue 10:00, Wed 15:30 and Fri 09:00.',
    'Move the Friday one to Monday.',
    'Done. Friday 09:00 is now Monday 09:00; the contact was notified.',
    'Any invoices pending for those contacts?',
    'Two: INV-0412 (S/ 1,250.00, 12 days overdue) and INV-0419 (S/ 380.00, due Friday).',
  ];
  const turn = (i) => ({ i, user: i % 2 === 0, text: `${LINES[i % LINES.length]}${i > 5 ? ` (turn ${i + 1})` : ''}` });
  const turns = (n) => Array.from({ length: n }, (_, i) => turn(i));

  const { Story } = defineMeta({
    title: 'AI/AiConversation',
    component: AiConversation,
    tags: ['autodocs'],
    args: { class: 'h-96 w-full rounded-lg border border-border-default bg-canvas', viewportClass: 'flex flex-col gap-3 p-4' },
  });
</script>

<script>
  // "Streaming last" grows the thread on demand so the follow/pill behaviour can be seen.
  let live = $state(turns(8));
  let partial = $state('');
  const grow = () => {
    partial += ' more streamed text';
    if (partial.length > 120) {
      live = [...live, turn(live.length)];
      partial = '';
    }
  };
</script>

{#snippet bubble(t, streaming = false, error = false)}
  <AiMessage from={t.user ? 'user' : 'assistant'} timestamp={`10:${String(40 + (t.i % 20)).padStart(2, '0')}`}>
    <div class="rounded-lg px-3 py-2 t-body {t.user ? 'bg-accent text-on-accent' : error ? 'border border-danger-border text-danger-fg' : 'bg-surface-2 text-foreground'}">
      {t.text}{#if streaming}<span class="text-tertiary">▍</span>{/if}
    </div>
  </AiMessage>
{/snippet}

<Story name="Empty">
  {#snippet template(args)}
    <AiConversation {...args} contentKey={0}>
      <p class="m-auto t-caption text-muted-foreground">No messages yet.</p>
    </AiConversation>
  {/snippet}
</Story>

<Story name="Short 3 turns">
  {#snippet template(args)}
    <AiConversation {...args} contentKey={3}>
      {#each turns(3) as t (t.i)}{@render bubble(t)}{/each}
    </AiConversation>
  {/snippet}
</Story>

<Story name="Long 40 turns scroll up for the pill">
  {#snippet template(args)}
    <AiConversation {...args} contentKey={40}>
      {#each turns(40) as t (t.i)}{@render bubble(t)}{/each}
    </AiConversation>
  {/snippet}
</Story>

<Story name="Streaming last click Grow">
  {#snippet template(args)}
    <div class="flex flex-col gap-2">
      <div><Button size="sm" onclick={grow}>Grow</Button></div>
      <AiConversation {...args} contentKey={`${live.length}:${partial.length}`}>
        {#each live as t (t.i)}{@render bubble(t)}{/each}
        {@render bubble({ i: live.length, user: false, text: `Streaming reply${partial}` }, true)}
      </AiConversation>
    </div>
  {/snippet}
</Story>

<Story name="Error last">
  {#snippet template(args)}
    <AiConversation {...args} contentKey={6}>
      {#each turns(5) as t (t.i)}{@render bubble(t)}{/each}
      {@render bubble({ i: 5, user: false, text: 'The gateway did not answer in 15 s. Try again.' }, false, true)}
    </AiConversation>
  {/snippet}
</Story>

<Story name="Short host 160 px" args={{ class: 'h-40 w-full rounded-lg border border-border-default bg-canvas' }}>
  {#snippet template(args)}
    <AiConversation {...args} contentKey={12}>
      {#each turns(12) as t (t.i)}{@render bubble(t)}{/each}
    </AiConversation>
  {/snippet}
</Story>
