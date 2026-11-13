<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import type { ComponentProps } from 'svelte';
  import ProfileMenu from '$lib/components/layout/ProfileMenu.svelte';

  const user = {
    id: 'u-1',
    role: 'admin',
    email: 'ana.castillo@example.com',
    displayName: 'Ana Castillo',
    avatarUrl: null,
  };
  const channels = [
    { channel: 'dev', serverId: 'gw-dev', healthy: true },
    { channel: 'prd', serverId: 'gw-prd', healthy: true },
  ];
  const data = (d: Record<string, unknown>) => ({
    sveltekit_experimental: { state: { page: { data: d } } },
  });

  const { Story } = defineMeta({
    title: 'Components/Navigation/ProfileMenu',
    component: ProfileMenu,
    tags: ['autodocs'],
    parameters: {
      docs: { story: { inline: false, height: '340px' } },
      ...data({ user, hosts: { servers: [], channels: [] } }),
    },
    argTypes: { placement: { control: 'select', options: ['top', 'bottom', 'left', 'right'] } },
    args: { placement: 'bottom' },
  });

  const open: NonNullable<ComponentProps<typeof Story>['play']> = async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getAllByRole('button')[0]);
  };
</script>

<Story name="Closed">
  {#snippet template(args)}
    <div class="p-2"><ProfileMenu {...args} /></div>
  {/snippet}
</Story>

<Story name="Open" play={open}>
  {#snippet template(args)}
    <div class="p-2"><ProfileMenu {...args} /></div>
  {/snippet}
</Story>

<Story
  name="Admin with two build channels"
  play={open}
  parameters={data({ user, hosts: { servers: [], channels } })}
>
  {#snippet template(args)}
    <div class="p-2"><ProfileMenu {...args} /></div>
  {/snippet}
</Story>

<Story
  name="Dev backend (user switcher row)"
  play={open}
  parameters={data({ user, hosts: { servers: [], channels }, env: { backend: 'dev' } })}
>
  {#snippet template(args)}
    <div class="p-2"><ProfileMenu {...args} /></div>
  {/snippet}
</Story>

<Story
  name="Regular member"
  play={open}
  parameters={data({
    user: { ...user, role: 'user', displayName: null },
    hosts: { servers: [], channels },
  })}
>
  {#snippet template(args)}
    <div class="p-2"><ProfileMenu {...args} /></div>
  {/snippet}
</Story>

<Story name="Placement right (sidebar)" args={{ placement: 'right' }} play={open}>
  {#snippet template(args)}
    <div class="p-2"><ProfileMenu {...args} /></div>
  {/snippet}
</Story>
