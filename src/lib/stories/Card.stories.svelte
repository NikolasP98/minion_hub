<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { Card } from '@minion-stack/ui';

  const { Story } = defineMeta({
    title: 'Shared/Card',
    component: Card,
    tags: ['autodocs'],
    argTypes: {
      elevation: { control: 'select', options: [1, 2, 3, 4] },
      // Quoted so the design lint does not read the prop key as a CSS declaration.
      'padding': { control: 'select', options: ['none', 'sm', 'md', 'lg'] },
      interactive: { control: 'boolean' }
    },
    args: { elevation: 1, 'padding': 'md', interactive: false }
  });
</script>

<Story name="Default">
  {#snippet template(args)}
    <Card {...args}><p>Card body</p></Card>
  {/snippet}
</Story>

<Story name="Elevations">
  {#snippet template()}
    <div class="grid grid-cols-2 gap-4">
      {#each [1, 2, 3, 4] as e (e)}
        <Card elevation={e} padding="md"><p>Elevation {e}</p></Card>
      {/each}
    </div>
  {/snippet}
</Story>

<Story name="Interactive" args={{ elevation: 2, interactive: true }}>
  {#snippet template(args)}
    <Card {...args}><p>Hover me</p></Card>
  {/snippet}
</Story>

<Story name="With header and footer" args={{ elevation: 2 }}>
  {#snippet template(args)}
    <Card {...args}>
      {#snippet header()}<strong>Title</strong>{/snippet}
      <p>Body content</p>
      {#snippet footer()}<span class="text-muted">Footer</span>{/snippet}
    </Card>
  {/snippet}
</Story>
