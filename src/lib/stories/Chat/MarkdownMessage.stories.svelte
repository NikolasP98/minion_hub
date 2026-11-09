<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import MarkdownMessage from '$lib/components/chat/MarkdownMessage.svelte';

  const headings =
    '# Heading 1\n\n## Heading 2\n\n### Heading 3\n\nBody text with **bold**, _italic_, ~~strike~~ and `inline code`.';
  const lists =
    '1. First\n2. Second\n   - nested bullet\n   - another\n3. Third\n\n- [x] done task\n- [ ] open task';
  const table =
    '| Invoice | Contact | Amount | Status |\n|---|---|---:|---|\n| INV-0412 | Ana Torres | S/ 1,250.00 | overdue |\n| INV-0419 | Luis Paredes Quispe Huamán | S/ 380.00 | due Fri |\n| INV-0423 | Marta Ríos | S/ 12,480,000.50 | paid |\n| INV-0424 | A very long contact name that forces the column wide | S/ 0.00 | void |';
  const code =
    'Run:\n\n```bash\nminion doctor --json | jq .infisical\n```\n\n```ts\nexport function fmt(n: number) {\n  return new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN" }).format(n);\n}\n```';
  const links =
    'External: [MDN](https://developer.mozilla.org). Internal: [the calendar](/scheduling) and [stock](/stock/items). Autolink: https://svelte.dev';
  const long = Array.from(
    { length: 12 },
    (_, i) =>
      `## Section ${i + 1}\n\n${'Paragraph text that keeps going for a while so the bubble gets tall. '.repeat(4)}\n\n- point a\n- point b`,
  ).join('\n\n');
  const choice =
    'Which way?\n\n```minion-ui\n{"tool":"ui.choice","input":{"question":"Learn or do?","options":[{"label":"Show me how"},{"label":"Just do it"}]}}\n```';
  const blockOnly =
    '```minion-ui\n{"tool":"fill_booking_form","input":{"contact":"Ana"}}\n```\n\n```minion-ui\n{"tool":"ui.guide","input":{"steps":[]}}\n```';

  const { Story } = defineMeta({
    title: 'Chat/MarkdownMessage',
    component: MarkdownMessage,
    tags: ['autodocs'],
    argTypes: { tone: { control: 'select', options: ['assistant', 'user'] } },
    args: { tone: 'assistant', onChoice: fn() },
  });
</script>

<Story name="Headings inline" args={{ value: headings }}>
  {#snippet template(args)}<div class="w-full max-w-xl rounded-lg bg-surface-2 p-3">
      <MarkdownMessage {...args} />
    </div>{/snippet}
</Story>

<Story name="Lists" args={{ value: lists }}>
  {#snippet template(args)}<div class="w-full max-w-xl rounded-lg bg-surface-2 p-3">
      <MarkdownMessage {...args} />
    </div>{/snippet}
</Story>

<Story name="Table scroll compact toggle" args={{ value: table }}>
  {#snippet template(args)}<div class="w-full max-w-xl rounded-lg bg-surface-2 p-3">
      <MarkdownMessage {...args} />
    </div>{/snippet}
</Story>

<Story name="Code blocks" args={{ value: code }}>
  {#snippet template(args)}<div class="w-full max-w-xl rounded-lg bg-surface-2 p-3">
      <MarkdownMessage {...args} />
    </div>{/snippet}
</Story>

<Story name="Links internal external" args={{ value: links }}>
  {#snippet template(args)}<div class="w-full max-w-xl rounded-lg bg-surface-2 p-3">
      <MarkdownMessage {...args} />
    </div>{/snippet}
</Story>

<Story name="Long" args={{ value: long }}>
  {#snippet template(args)}<div class="w-full max-w-xl rounded-lg bg-surface-2 p-3">
      <MarkdownMessage {...args} />
    </div>{/snippet}
</Story>

<Story
  name="User tone"
  args={{ value: 'Move the **Friday** one to Monday, see [calendar](/scheduling).', tone: 'user' }}
>
  {#snippet template(args)}<div class="w-full max-w-xl rounded-lg bg-accent p-3 text-on-accent">
      <MarkdownMessage {...args} />
    </div>{/snippet}
</Story>

<Story name="ui choice buttons" args={{ value: choice }}>
  {#snippet template(args)}<div class="w-full max-w-xl rounded-lg bg-surface-2 p-3">
      <MarkdownMessage {...args} />
    </div>{/snippet}
</Story>

<Story name="ui choice no send path disabled" args={{ value: choice, onChoice: undefined }}>
  {#snippet template(args)}<div class="w-full max-w-xl rounded-lg bg-surface-2 p-3">
      <MarkdownMessage {...args} />
    </div>{/snippet}
</Story>

<Story name="Block only reply action chips" args={{ value: blockOnly }}>
  {#snippet template(args)}<div class="w-full max-w-xl rounded-lg bg-surface-2 p-3">
      <MarkdownMessage {...args} />
    </div>{/snippet}
</Story>

<Story name="Empty" args={{ value: '' }}>
  {#snippet template(args)}<div class="w-full max-w-xl rounded-lg bg-surface-2 p-3">
      <MarkdownMessage {...args} />
    </div>{/snippet}
</Story>

<Story
  name="Table · Phone"
  args={{ value: table }}
  globals={{ viewport: { value: 'phone', isRotated: false } }}
>
  {#snippet template(args)}<div class="w-full rounded-lg bg-surface-2 p-3">
      <MarkdownMessage {...args} />
    </div>{/snippet}
</Story>
