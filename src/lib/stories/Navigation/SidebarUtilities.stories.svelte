<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import SidebarUtilities from '$lib/components/layout/SidebarUtilities.svelte';

  const pageData = {
    user: { id: 'u-1', role: 'admin', email: 'ana@example.com', displayName: 'Ana Castillo' },
    permissions: { permissions: ['users:manage'], roles: ['owner'] },
    activeOrgKind: 'business',
    hosts: { servers: [], channels: [] },
    env: { backend: 'dev' },
  };

  const { Story } = defineMeta({
    title: 'Navigation/SidebarUtilities',
    component: SidebarUtilities,
    tags: ['autodocs'],
    parameters: { sveltekit_experimental: { state: { page: { data: pageData } } } },
    argTypes: { collapsed: { control: 'boolean' } },
    args: { collapsed: false },
  });
</script>

<Story name="Expanded row">
  {#snippet template(args)}
    <div class="w-56 surface-1 p-2"><SidebarUtilities {...args} /></div>
  {/snippet}
</Story>

<Story name="Collapsed (vertical rail)" args={{ collapsed: true }}>
  {#snippet template(args)}
    <div class="w-14 surface-1 p-2"><SidebarUtilities {...args} /></div>
  {/snippet}
</Story>

<Story
  name="No env badge (deployed prd)"
  parameters={{
    sveltekit_experimental: {
      state: { page: { data: { ...pageData, env: { backend: 'prd', local: false } } } },
    },
  }}
>
  {#snippet template(args)}
    <div class="w-56 surface-1 p-2"><SidebarUtilities {...args} /></div>
  {/snippet}
</Story>
