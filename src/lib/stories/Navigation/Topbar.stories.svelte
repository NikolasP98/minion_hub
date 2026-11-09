<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Topbar from '$lib/components/layout/Topbar.svelte';

  // Mobile-only header (`md:hidden`): shown at a phone viewport.
  const pageData = {
    user: { id: 'u-1', role: 'admin', email: 'ana@example.com', displayName: 'Ana Castillo' },
    permissions: { permissions: ['settings:manage', 'users:manage'], roles: ['owner'] },
    activeOrgKind: 'business',
    activeOrgId: 'org-1',
    organizations: [
      { id: 'org-1', name: 'Faces Lima', slug: 'faces', role: 'owner', kind: 'business' },
    ],
    hosts: { servers: [], channels: [] },
    workspaces: [],
    env: { backend: 'dev' },
    schedulingEnabled: true,
    preferences: { preferences: {} },
  };

  const { Story } = defineMeta({
    title: 'Navigation/Topbar',
    component: Topbar,
    tags: ['autodocs'],
    parameters: { sveltekit_experimental: { state: { page: { data: pageData } } } },
    globals: { viewport: { value: 'phone', isRotated: false } },
  });
</script>

<Story name="Mobile header">
  {#snippet template()}
    <div class="surface-1"><Topbar /></div>
  {/snippet}
</Story>

<Story
  name="Menu open"
  play={async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Toggle menu' }));
  }}
>
  {#snippet template()}
    <div class="surface-1 h-[640px]"><Topbar /></div>
  {/snippet}
</Story>
