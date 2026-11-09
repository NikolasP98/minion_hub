<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import ChatInput from '$lib/components/my-agent/ChatInput.svelte';

  // Suggestion popovers (`/skills`, `@mentions`, channel pickers) read gateway state;
  // offline they simply show nothing. Everything else is prop-driven.
  const { Story } = defineMeta({
    title: 'Chat/ChatInput',
    component: ChatInput,
    tags: ['autodocs'],
    argTypes: { running: { control: 'boolean' } },
    args: { onsubmit: fn(), onstop: fn(), ownerKey: 'agent-1', agentId: null },
  });
</script>

<Story name="Empty">
  {#snippet template(args)}<div class="w-full max-w-xl"><ChatInput {...args} /></div>{/snippet}
</Story>

<Story name="Typed ask mode" args={{ value: 'Move the Friday booking to Monday' }}>
  {#snippet template(args)}<div class="w-full max-w-xl"><ChatInput {...args} /></div>{/snippet}
</Story>

<Story name="Capture mode prefix" args={{ value: '# Remember: Ana prefers mornings' }}>
  {#snippet template(args)}<div class="w-full max-w-xl"><ChatInput {...args} /></div>{/snippet}
</Story>

<Story name="Multiline" args={{ value: 'First line.\nSecond line.\n\nFourth line after a blank.' }}>
  {#snippet template(args)}<div class="w-full max-w-xl"><ChatInput {...args} /></div>{/snippet}
</Story>

<Story name="Running Stop" args={{ running: true, value: 'Next question while it answers' }}>
  {#snippet template(args)}<div class="w-full max-w-xl"><ChatInput {...args} /></div>{/snippet}
</Story>

<Story name="Custom placeholder" args={{ placeholder: 'Write a note for the team…' }}>
  {#snippet template(args)}<div class="w-full max-w-xl"><ChatInput {...args} /></div>{/snippet}
</Story>

<Story
  name="Narrow host"
  args={{ value: 'A draft in a 280 px column that has to wrap over several lines' }}
>
  {#snippet template(args)}<div class="w-70"><ChatInput {...args} /></div>{/snippet}
</Story>

<Story
  name="Typed · Phone"
  args={{ value: 'Move the Friday booking to Monday' }}
  globals={{ viewport: { value: 'phone', isRotated: false } }}
>
  {#snippet template(args)}<div class="w-full"><ChatInput {...args} /></div>{/snippet}
</Story>
