<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import AiPromptInput from '$lib/components/ai/AiPromptInput.svelte';
  import { SegmentedControl } from '$lib/components/ui';

  const attachments = [
    { id: 'a1', name: 'factura-0412.pdf', size: 184_320 },
    { id: 'a2', name: 'IMG_20261108_094512_very_long_camera_filename.jpg', size: 3_145_728 },
    { id: 'a3', name: 'notes.txt' },
  ];
  const multiline =
    'First line of the draft.\nSecond line, after Shift+Enter.\n\nA fourth line after a blank one.';
  const tall = Array.from(
    { length: 14 },
    (_, i) => `Line ${i + 1} of a draft taller than MAX_ROWS, so the box scrolls.`,
  ).join('\n');

  const draft = (n: number) =>
    Array.from({ length: n }, (_, i) => `Draft line ${i + 1}`).join('\n');

  const { Story } = defineMeta({
    title: 'Components/AI/AiPromptInput',
    component: AiPromptInput,
    tags: ['autodocs'],
    argTypes: {
      status: { control: 'select', options: ['idle', 'thinking', 'streaming', 'done', 'error'] },
      disabled: { control: 'boolean' },
      compact: { control: 'boolean' },
    },
    args: {
      placeholder: 'Ask your agent',
      onsubmit: fn(),
      onstop: fn(),
      onattach: fn(),
      onremoveattachment: fn(),
    },
  });
</script>

<Story name="Empty">
  {#snippet template(args)}<div class="w-full max-w-xl"><AiPromptInput {...args} /></div>{/snippet}
</Story>

<Story name="Typed" args={{ value: 'Move the Friday booking to Monday' }}>
  {#snippet template(args)}<div class="w-full max-w-xl"><AiPromptInput {...args} /></div>{/snippet}
</Story>

<Story name="Multiline" args={{ value: multiline }}>
  {#snippet template(args)}<div class="w-full max-w-xl"><AiPromptInput {...args} /></div>{/snippet}
</Story>

<Story name="Tall draft scrolls past 8 rows" args={{ value: tall }}>
  {#snippet template(args)}<div class="w-full max-w-xl"><AiPromptInput {...args} /></div>{/snippet}
</Story>

<Story name="Grows 1 line" args={{ value: draft(1) }}>
  {#snippet template(args)}<div class="w-full max-w-xl"><AiPromptInput {...args} /></div>{/snippet}
</Story>

<Story name="Grows 6 lines" args={{ value: draft(6) }}>
  {#snippet template(args)}<div class="w-full max-w-xl"><AiPromptInput {...args} /></div>{/snippet}
</Story>

<Story name="Grows 20 lines capped and scrolling" args={{ value: draft(20) }}>
  {#snippet template(args)}<div class="w-full max-w-xl"><AiPromptInput {...args} /></div>{/snippet}
</Story>

<Story name="Disabled" args={{ disabled: true, value: 'Cannot send while offline' }}>
  {#snippet template(args)}<div class="w-full max-w-xl"><AiPromptInput {...args} /></div>{/snippet}
</Story>

<Story name="Sending streaming to Stop" args={{ status: 'streaming' }}>
  {#snippet template(args)}<div class="w-full max-w-xl"><AiPromptInput {...args} /></div>{/snippet}
</Story>

<Story name="Thinking to Stop" args={{ status: 'thinking', value: 'Next draft while it thinks' }}>
  {#snippet template(args)}<div class="w-full max-w-xl"><AiPromptInput {...args} /></div>{/snippet}
</Story>

<Story name="Error ringed" args={{ status: 'error', value: 'The last send failed' }}>
  {#snippet template(args)}<div class="w-full max-w-xl"><AiPromptInput {...args} /></div>{/snippet}
</Story>

<Story name="With attachments" args={{ attachments, value: 'Attach these to the invoice' }}>
  {#snippet template(args)}<div class="w-full max-w-xl"><AiPromptInput {...args} /></div>{/snippet}
</Story>

<Story
  name="Attachments only allowEmpty"
  args={{ attachments: attachments.slice(0, 1), allowEmpty: true }}
>
  {#snippet template(args)}<div class="w-full max-w-xl"><AiPromptInput {...args} /></div>{/snippet}
</Story>

<Story name="Counter near limit" args={{ maxLength: 200, value: 'x'.repeat(170) }}>
  {#snippet template(args)}<div class="w-full max-w-xl"><AiPromptInput {...args} /></div>{/snippet}
</Story>

<Story name="Over limit danger" args={{ maxLength: 200, value: 'y'.repeat(231) }}>
  {#snippet template(args)}<div class="w-full max-w-xl"><AiPromptInput {...args} /></div>{/snippet}
</Story>

<Story name="Compact floating panel" args={{ compact: true, value: 'Compact composer' }}>
  {#snippet template(args)}<div class="w-80"><AiPromptInput {...args} /></div>{/snippet}
</Story>

<Story name="With toolbar children mode picker">
  {#snippet template(args)}
    <div class="w-full max-w-xl">
      <AiPromptInput {...args}>
        <SegmentedControl
          items={[
            { value: 'ask', label: 'Ask' },
            { value: 'capture', label: 'Capture' },
          ]}
          value="ask"
          aria-label="Mode"
          onValueChange={fn()}
        />
      </AiPromptInput>
    </div>
  {/snippet}
</Story>

<Story
  name="Typed · Phone"
  args={{ value: multiline, attachments }}
  globals={{ viewport: { value: 'phone', isRotated: false } }}
>
  {#snippet template(args)}<div class="w-full"><AiPromptInput {...args} /></div>{/snippet}
</Story>
