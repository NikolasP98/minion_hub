<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Sidebar from '$lib/components/layout/Sidebar.svelte';

  // The shell sidebar is wired to page.data (org, permissions, nav config, hosts)
  // and module state; this is the admin business-org shape the layout load produces.
  const pageData = {
    user: { id: 'u-1', role: 'admin', email: 'ana@example.com', displayName: 'Ana Castillo' },
    permissions: { permissions: ['settings:manage', 'users:manage'], roles: ['owner'] },
    activeOrgKind: 'business',
    activeOrgId: 'org-1',
    organizations: [
      { id: 'org-1', name: 'Faces Lima', slug: 'faces', role: 'owner', kind: 'business' },
      { id: 'org-2', name: 'Personal', slug: null, role: 'owner', kind: 'personal' },
    ],
    hosts: { servers: [{ id: 'gw-1', name: 'netcup-prd', url: 'wss://gw.example.com', lastConnectedAt: Date.now() - 60000, channel: 'prd' }], channels: [{ channel: 'prd', serverId: 'gw-1', healthy: true }], defaultChannel: 'prd' },
    env: { backend: 'dev', local: true },
    schedulingEnabled: true,
    preferences: { preferences: {} },
  };

  const { Story } = defineMeta({
    title: 'Navigation/Sidebar',
    component: Sidebar,
    tags: ['autodocs'],
    parameters: { sveltekit_experimental: { state: { page: { data: pageData } } } },
  });
</script>

<Story name="Expanded (admin, business org)">
  {#snippet template()}
    <div class="h-[640px] flex surface-1"><Sidebar /></div>
  {/snippet}
</Story>

<Story name="Collapsed rail" play={async ({ canvasElement }) => { canvasElement.querySelector('.collapse-btn')?.click(); }}>
  {#snippet template()}
    <div class="h-[640px] flex surface-1"><Sidebar /></div>
  {/snippet}
</Story>

<Story name="Member (no admin rows)" parameters={{ sveltekit_experimental: { state: { page: { data: { ...pageData, user: { ...pageData.user, role: 'user' }, permissions: { permissions: [], roles: ['staff'] } } } } } }}>
  {#snippet template()}
    <div class="h-[640px] flex surface-1"><Sidebar /></div>
  {/snippet}
</Story>

<Story name="Personal org" parameters={{ sveltekit_experimental: { state: { page: { data: { ...pageData, activeOrgKind: 'personal', activeOrgId: 'org-2' } } } } }}>
  {#snippet template()}
    <div class="h-[640px] flex surface-1"><Sidebar /></div>
  {/snippet}
</Story>

<!-- Responsive: `hidden md:flex` — nothing renders below 768px (Topbar takes over); from 768px the 224px sidebar shows. -->
<Story name="Expanded (admin, business org) · Phone" globals={{ viewport: { value: 'phone', isRotated: false } }}>
  {#snippet template()}
    <p class="text-xs text-muted-foreground mb-2">Hidden below 768px; see Navigation/Topbar for the phone header.</p>
    <div class="h-[640px] flex surface-1"><Sidebar /></div>
  {/snippet}
</Story>

<Story name="Expanded (admin, business org) · Tablet" globals={{ viewport: { value: 'tablet', isRotated: false } }}>
  {#snippet template()}
    <div class="h-[640px] flex surface-1"><Sidebar /></div>
  {/snippet}
</Story>
