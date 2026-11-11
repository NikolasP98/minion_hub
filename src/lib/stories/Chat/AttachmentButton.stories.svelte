<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import AttachmentButton from '$lib/components/attachments/AttachmentButton.svelte';

  // Pick-only mode (`onpick`, no `objectId`): files are validated and handed back,
  // never uploaded. The upload progress/failed states need a live API — not shown here.
  const { Story } = defineMeta({
    title: 'Components/Chat/AttachmentButton',
    component: AttachmentButton,
    tags: ['autodocs'],
    argTypes: {
      size: { control: 'select', options: ['xs', 'sm', 'md', 'lg'] },
      variant: { control: 'select', options: ['primary', 'secondary', 'outline', 'ghost'] },
      hint: { control: 'select', options: ['inline', 'tooltip'] },
      disabled: { control: 'boolean' },
    },
    args: { objectType: 'crm_contact', onpick: fn() },
  });
</script>

<Story name="Pick only inline hint" />
<Story name="Tooltip hint compact header" args={{ hint: 'tooltip' }} />
<Story name="Custom label" args={{ label: 'Add photos' }} />
<Story name="Disabled" args={{ disabled: true }} />
<Story name="Primary md" args={{ variant: 'primary', size: 'md' }} />
<Story name="Ghost xs" args={{ variant: 'ghost', size: 'xs', hint: 'tooltip' }} />

<Story name="Narrow host hint wraps">
  {#snippet template(args)}<div class="w-48"><AttachmentButton {...args} /></div>{/snippet}
</Story>
