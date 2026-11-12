<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import type { ComponentProps } from 'svelte';
  import OrgPicker from '$lib/components/layout/OrgPicker.svelte';

  const orgs = [
    { id: 'org-1', name: 'Faces Lima', slug: 'faces', role: 'owner', kind: 'business' },
    { id: 'org-2', name: 'Barberia El Norte', slug: 'norte', role: 'admin', kind: 'business' },
    { id: 'org-3', name: 'Ana (personal)', slug: null, role: 'owner', kind: 'personal' },
  ];
  const data = (organizations: typeof orgs, activeOrgId: string | null) => ({
    sveltekit_experimental: { state: { page: { data: { organizations, activeOrgId } } } },
  });

  const { Story } = defineMeta({
    title: 'Components/Navigation/OrgPicker',
    component: OrgPicker,
    tags: ['autodocs'],
    parameters: { docs: { story: { inline: false, height: '240px' } }, ...data(orgs, 'org-1') },
  });

  const open: NonNullable<ComponentProps<typeof Story>['play']> = async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getAllByRole('button')[0]);
  };
</script>

<Story name="Multiple orgs (switchable)">
  {#snippet template()}
    <div class="w-52 surface-1 p-2"><OrgPicker /></div>
  {/snippet}
</Story>

<Story name="Open" play={open}>
  {#snippet template()}
    <div class="w-52 surface-1 p-2"><OrgPicker /></div>
  {/snippet}
</Story>

<Story name="Single org (no switch)" parameters={data(orgs.slice(0, 1), 'org-1')}>
  {#snippet template()}
    <div class="w-52 surface-1 p-2"><OrgPicker /></div>
  {/snippet}
</Story>

<Story name="Personal org active" parameters={data(orgs, 'org-3')}>
  {#snippet template()}
    <div class="w-52 surface-1 p-2"><OrgPicker /></div>
  {/snippet}
</Story>

<Story
  name="Long org name"
  parameters={data(
    [
      {
        id: 'x',
        name: 'Centro Estetico Integral de la Molina y alrededores',
        slug: 'x',
        role: 'owner',
        kind: 'business',
      },
      orgs[2],
    ],
    'x',
  )}
>
  {#snippet template()}
    <div class="w-52 surface-1 p-2"><OrgPicker /></div>
  {/snippet}
</Story>

<Story name="No organizations (renders nothing)" parameters={data([], null)}>
  {#snippet template()}
    <div class="w-52 surface-1 p-2"><OrgPicker /></div>
  {/snippet}
</Story>
