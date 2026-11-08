<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import { Copy, Pencil, RotateCcw, ThumbsDown, ThumbsUp, Trash2, Volume2 } from 'lucide-svelte';
  import MessageActions from '$lib/components/my-agent/MessageActions.svelte';

  const actions = [
    { icon: Copy, label: 'Copy', onclick: fn(), confirm: true },
    { icon: RotateCcw, label: 'Retry', onclick: fn() },
    { icon: ThumbsUp, label: 'Good answer', onclick: fn() },
  ];
  const many = [
    ...actions,
    { icon: ThumbsDown, label: 'Bad answer', onclick: fn() },
    { icon: Volume2, label: 'Read aloud', onclick: fn() },
    { icon: Pencil, label: 'Edit', onclick: fn() },
    { icon: Trash2, label: 'Delete', onclick: fn() },
  ];

  const { Story } = defineMeta({
    title: 'Chat/MessageActions',
    component: MessageActions,
    tags: ['autodocs'],
    argTypes: { side: { control: 'select', options: ['start', 'end'] }, reveal: { control: 'boolean' } },
    args: { actions, reveal: false, side: 'start' },
  });
</script>

<Story name="Always visible" />
<Story name="Single action copy click for the check" args={{ actions: actions.slice(0, 1) }} />
<Story name="Many actions" args={{ actions: many }} />
<Story name="Empty" args={{ actions: [] }} />

<!-- `reveal` fades the row in only while the enclosing `.ai-message` is hovered or focused. -->
<Story name="Reveal on hover start side" args={{ reveal: true }}>
  {#snippet template(args)}
    <div class="ai-message flex w-64 flex-col items-start gap-1 rounded-lg p-2">
      <div class="rounded-lg bg-surface-2 px-3 py-2 t-body">Hover this message.</div>
      <MessageActions {...args} />
    </div>
  {/snippet}
</Story>

<Story name="Reveal on hover end side user" args={{ reveal: true, side: 'end', actions: [{ icon: Pencil, label: 'Edit', onclick: fn() }, { icon: Copy, label: 'Copy', onclick: fn(), confirm: true }] }}>
  {#snippet template(args)}
    <div class="ai-message flex w-64 flex-col items-end gap-1 rounded-lg p-2">
      <div class="rounded-lg bg-accent px-3 py-2 t-body text-on-accent">Hover this message.</div>
      <MessageActions {...args} />
    </div>
  {/snippet}
</Story>
