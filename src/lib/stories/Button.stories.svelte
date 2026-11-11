<script module lang="ts">
  // Shared primitive from @minion-stack/ui — the variants the hub actually ships.
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { Button } from '@minion-stack/ui';

  const { Story } = defineMeta({
    title: 'Atoms/Actions/Button',
    component: Button,
    tags: ['autodocs'],
    argTypes: {
      variant: { control: 'select', options: ['primary', 'secondary', 'ghost', 'danger'] },
      size: { control: 'select', options: ['sm', 'md', 'lg'] },
      disabled: { control: 'boolean' },
    },
    args: { variant: 'primary', size: 'md', disabled: false },
  });
</script>

<Story name="Primary">
  {#snippet template(args)}
    <Button {...args}>Save changes</Button>
  {/snippet}
</Story>

<Story name="Secondary" args={{ variant: 'secondary' }}>
  {#snippet template(args)}
    <Button {...args}>Cancel</Button>
  {/snippet}
</Story>

<Story name="Danger" args={{ variant: 'danger' }}>
  {#snippet template(args)}
    <Button {...args}>Delete</Button>
  {/snippet}
</Story>

<Story name="Disabled" args={{ disabled: true }}>
  {#snippet template(args)}
    <Button {...args}>Unavailable</Button>
  {/snippet}
</Story>
