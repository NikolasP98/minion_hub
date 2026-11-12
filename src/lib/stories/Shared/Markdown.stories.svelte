<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import MarkdownView from '$lib/components/prompt/MarkdownView.svelte';

  // What a typical .md file on disk looks like once the hub renders it.
  const KITCHEN_SINK = `# Minion hub

A short intro paragraph with **bold**, *italic*, ~~struck~~ and \`inline code\`. A [link to the docs](https://example.com/docs) and an autolink https://example.com.

## Headings and text

### Third level

#### Fourth level

> A blockquote with a second line
> that wraps and includes \`code\`.

## Lists

- Unordered item
- Another item
  - Nested item
  - Nested item with a longer sentence that should wrap onto a second line at phone width.
- Last item

1. Ordered first
2. Ordered second
3. Ordered third

- [x] Done task
- [ ] Open task

## Table

| Column | Type | Default | Notes |
|---|---|---|---|
| id | uuid | generated | primary key |
| name | text | — | long free text up to 240 characters |
| amount | numeric(12,2) | 0.00 | 1234567890.12 |
| created_at | timestamptz | now() | |

## Code

\`\`\`ts
export function applyTheme(p: ThemePreset, accent: string) {
  document.documentElement.setAttribute('data-minion-theme', p.id);
  document.documentElement.style.setProperty('--color-accent', accent);
}
\`\`\`

\`\`\`bash
bun run storybook
\`\`\`

---

Final paragraph after a horizontal rule.
`;

  const SPEC_FILE = `---
id: 2026-11-08-example-spec
status: draft
verdict: pending
---

# Example spec

## AS-IS

The booking drawer opens from the calendar and loads its data on mount.

## TO-BE

The drawer receives its data as props so it can render offline.

## DELTA

| Transition | Test |
|---|---|
| fetch on mount → props | BookingDetailDrawer.stories.svelte |
`;

  const AGENT_FILE = `---
name: customer-support
description: Answers customer questions using the knowledge base.
tools: [search, email]
---

You are a support agent for a small clinic.

1. Greet the customer by name.
2. Search the knowledge base before answering.
3. Escalate anything about payments.
`;

  const LONG = Array.from(
    { length: 12 },
    (_, i) =>
      `## Section ${i + 1}\n\nParagraph ${i + 1}. ${'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(4)}\n\n- point a\n- point b\n`,
  ).join('\n');

  const { Story } = defineMeta({
    title: 'Components/Shared/Markdown',
    component: MarkdownView,
    tags: ['autodocs'],
    argTypes: { value: { control: 'text' } },
    args: { value: KITCHEN_SINK },
  });
</script>

<Story name="Kitchen sink">
  {#snippet template(args)}
    <div class="max-w-3xl"><MarkdownView {...args} /></div>
  {/snippet}
</Story>

<Story name="Kitchen sink · Phone" globals={{ viewport: { value: 'phone', isRotated: false } }}>
  {#snippet template(args)}
    <MarkdownView {...args} />
  {/snippet}
</Story>

<Story name="Spec file with frontmatter" args={{ value: SPEC_FILE }}>
  {#snippet template(args)}
    <div class="max-w-3xl"><MarkdownView {...args} /></div>
  {/snippet}
</Story>

<Story name="Agent definition" args={{ value: AGENT_FILE }}>
  {#snippet template(args)}
    <div class="max-w-3xl"><MarkdownView {...args} /></div>
  {/snippet}
</Story>

<Story name="Long document" args={{ value: LONG }}>
  {#snippet template(args)}
    <div class="max-w-3xl h-96 overflow-auto rounded-md border border-border p-3">
      <MarkdownView {...args} />
    </div>
  {/snippet}
</Story>

<Story
  name="Raw HTML is sanitized"
  args={{
    value:
      'Text before <script lang="ts">alert(1)</script><img src=x onerror="alert(1)"> text after.\n\n<b>Allowed inline HTML</b> stays.',
  }}
>
  {#snippet template(args)}
    <div class="max-w-3xl"><MarkdownView {...args} /></div>
  {/snippet}
</Story>

<Story name="Empty" args={{ value: '' }}>
  {#snippet template(args)}
    <div class="max-w-3xl rounded-md border border-dashed border-border p-3">
      <MarkdownView {...args} />
    </div>
  {/snippet}
</Story>
