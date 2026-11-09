<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import DocTimeline from '$lib/components/shared/DocTimeline.svelte';

  const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
  const comment = (id, body, actorName = 'Lucía Fernández', min = 5) => ({
    id,
    ts: ago(min),
    src: 'comment',
    kind: 'note',
    body,
    actorName,
    changes: null,
  });
  const audit = (id, changes, actorName = 'Marco Quispe', min = 30) => ({
    id,
    ts: ago(min),
    src: 'audit',
    kind: 'update',
    body: null,
    actorName,
    changes,
  });

  const comments = [
    comment('c1', 'Patient asked to move the follow-up to next week.'),
    comment('c2', 'Called back, confirmed Tuesday 10:30.', 'Marco Quispe', 60),
    comment('c3', 'No answer, left a WhatsApp.', null, 1440),
  ];
  const audits = [
    audit('a1', [{ label: 'Status', old: 'pending', new: 'confirmed' }]),
    audit(
      'a2',
      [
        { label: 'Phone', old: null, new: '+51 987 654 321' },
        { label: 'Email', old: 'old@example.com', new: 'new@example.com' },
      ],
      null,
      200,
    ),
    audit(
      'a3',
      [
        { label: 'Price', old: '350', new: '320' },
        { label: 'Discount', old: null, new: '30' },
        { label: 'Note', old: null, new: 'loyalty' },
        { label: 'Hidden', old: 'a', new: 'b' },
      ],
      'System',
      3000,
    ),
  ];

  const { Story } = defineMeta({
    title: 'Cards/DocTimeline',
    component: DocTimeline,
    tags: ['autodocs'],
    args: { onComment: fn() },
  });
</script>

<Story name="Empty" args={{ items: [] }}>
  {#snippet template(args)}<div class="w-96"><DocTimeline {...args} /></div>{/snippet}
</Story>

<Story name="Comments" args={{ items: comments }}>
  {#snippet template(args)}<div class="w-96"><DocTimeline {...args} /></div>{/snippet}
</Story>

<Story name="Audit entries" args={{ items: audits }}>
  {#snippet template(args)}<div class="w-96"><DocTimeline {...args} /></div>{/snippet}
</Story>

<Story
  name="Mixed"
  args={{ items: [comments[0], audits[0], comments[1], audits[1], comments[2], audits[2]] }}
>
  {#snippet template(args)}<div class="w-96"><DocTimeline {...args} /></div>{/snippet}
</Story>

<Story
  name="Long comment"
  args={{
    items: [
      comment(
        'l1',
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. '.repeat(
          4,
        ),
        'Anna-Maria von Hohenzollern-Sigmaringen',
      ),
    ],
  }}
>
  {#snippet template(args)}<div class="w-96"><DocTimeline {...args} /></div>{/snippet}
</Story>

<Story
  name="Many entries"
  args={{
    items: Array.from({ length: 30 }, (_, i) =>
      i % 2
        ? comment(`m${i}`, `Comment number ${i}`, 'Lucía', i * 17)
        : audit(`m${i}`, [{ label: 'Status', old: 'a', new: 'b' }], 'Marco', i * 17),
    ),
  }}
>
  {#snippet template(args)}<div class="w-96"><DocTimeline {...args} /></div>{/snippet}
</Story>

<Story
  name="Slow commit"
  args={{ items: comments, onComment: () => new Promise((r) => setTimeout(r, 2000)) }}
>
  {#snippet template(args)}<div class="w-96"><DocTimeline {...args} /></div>{/snippet}
</Story>
