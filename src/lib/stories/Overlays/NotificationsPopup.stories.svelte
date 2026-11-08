<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { Bell } from 'lucide-svelte';
  import NotificationsPopup from '$lib/components/layout/NotificationsPopup.svelte';
  import { iconSizes } from '$lib/components/ui';

  // The popup fetches /api/join-requests, /api/inbox and pulse itself; there is
  // no API in Storybook, so the open state shows the empty inbox.
  const { Story } = defineMeta({
    title: 'Overlays/NotificationsPopup',
    component: NotificationsPopup,
    tags: ['autodocs'],
    parameters: {
      docs: { story: { inline: false, height: '360px' } },
      sveltekit_experimental: { state: { page: { data: { user: { id: 'u-1', role: 'admin' }, permissions: { permissions: ['users:manage'], roles: ['owner'] }, activeOrgKind: 'business' } } } },
    },
    argTypes: { placement: { control: 'select', options: ['top', 'bottom', 'left', 'right', 'bottom-end'] } },
    args: { placement: 'bottom-end' },
  });
</script>

<Story name="Open (empty inbox)">
  {#snippet template(args)}
    <div class="flex justify-end p-4">
      <NotificationsPopup {...args} open={true}>
        {#snippet trigger()}<span class="inline-flex p-1 text-muted-foreground"><Bell size={iconSizes.sm} /></span>{/snippet}
      </NotificationsPopup>
    </div>
  {/snippet}
</Story>

<Story name="Trigger (closed)">
  {#snippet template(args)}
    <div class="flex justify-end p-4">
      <NotificationsPopup {...args}>
        {#snippet trigger()}<span class="inline-flex p-1 text-muted-foreground"><Bell size={iconSizes.sm} /></span>{/snippet}
      </NotificationsPopup>
    </div>
  {/snippet}
</Story>

<Story name="Placement right (sidebar)" args={{ placement: 'right' }}>
  {#snippet template(args)}
    <div class="p-4">
      <NotificationsPopup {...args} open={true}>
        {#snippet trigger()}<span class="inline-flex p-1 text-muted-foreground"><Bell size={iconSizes.sm} /></span>{/snippet}
      </NotificationsPopup>
    </div>
  {/snippet}
</Story>
