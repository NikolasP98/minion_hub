<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import CallControls from '$lib/components/my-agent/CallControls.svelte';

  const { Story } = defineMeta({
    title: 'Chat/CallControls',
    component: CallControls,
    tags: ['autodocs'],
    argTypes: {
      status: { control: 'select', options: ['idle', 'listening', 'thinking', 'speaking'] },
      active: { control: 'boolean' },
      muted: { control: 'boolean' },
      disabled: { control: 'boolean' },
    },
    args: { active: false, muted: false, status: 'idle', disabled: false, onstart: fn(), onend: fn(), ontoggleMute: fn() },
  });
</script>

<Story name="Inactive call button" />
<Story name="Disabled gateway offline" args={{ disabled: true }} />
<Story name="Active · listening" args={{ active: true, status: 'listening' }} />
<Story name="Active · thinking" args={{ active: true, status: 'thinking' }} />
<Story name="Active · speaking" args={{ active: true, status: 'speaking' }} />
<Story name="Active · muted" args={{ active: true, muted: true, status: 'idle' }} />
