<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import EditableName from '$lib/components/users/EditableName.svelte';

  // Double-click the name (or hover for the pencil) to edit; Enter/blur commits, Escape cancels.
  const { Story } = defineMeta({
    title: 'Forms/EditableName',
    component: EditableName,
    tags: ['autodocs'],
    argTypes: { placeholder: { control: 'text' } },
    args: { value: 'Lucía Fernández', onCommit: async () => true },
  });
</script>

<Story name="Default">
  {#snippet template(args)}<div class="w-80"><EditableName {...args} /></div>{/snippet}
</Story>

<Story name="Empty (placeholder)" args={{ value: '' }}>
  {#snippet template(args)}<div class="w-80"><EditableName {...args} /></div>{/snippet}
</Story>

<Story name="Custom placeholder" args={{ value: '', placeholder: 'Display name' }}>
  {#snippet template(args)}<div class="w-80"><EditableName {...args} /></div>{/snippet}
</Story>

<Story name="Long name (truncates)" args={{ value: 'Maximiliano Alejandro de la Cruz Villanueva-Echeverría y Sánchez de Lozada' }}>
  {#snippet template(args)}<div class="w-64 border border-border"><EditableName {...args} /></div>{/snippet}
</Story>

<Story name="Slow commit (pending indicator)" args={{ onCommit: () => new Promise((r) => setTimeout(() => r(true), 2500)) }}>
  {#snippet template(args)}<div class="w-80"><EditableName {...args} /></div>{/snippet}
</Story>

<Story name="Commit rejected (reverts)" args={{ onCommit: async () => false }}>
  {#snippet template(args)}<div class="w-80"><EditableName {...args} /></div>{/snippet}
</Story>

<Story name="Commit throws" args={{ onCommit: async () => { throw new Error('Network down'); } }}>
  {#snippet template(args)}<div class="w-80"><EditableName {...args} /></div>{/snippet}
</Story>
