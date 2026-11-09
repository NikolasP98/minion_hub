<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import ModuleSwitcher from '$lib/components/layout/ModuleSwitcher.svelte';

  const pageData = {
    user: { id: 'u-1', role: 'admin' },
    permissions: { permissions: ['settings:manage'], roles: ['owner'] },
    activeOrgKind: 'business',
    schedulingEnabled: true,
  };

  const { Story } = defineMeta({
    title: 'Navigation/ModuleSwitcher',
    component: ModuleSwitcher,
    tags: ['autodocs'],
    parameters: {
      docs: { story: { inline: false, height: '360px' } },
      sveltekit_experimental: { state: { page: { data: pageData } } },
    },
    argTypes: { collapsed: { control: 'boolean' }, busy: { control: 'boolean' } },
    args: { collapsed: false, busy: false, onExpand: fn() },
  });

  const open = async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getAllByRole('button')[0]);
  };
</script>

<Story name="Expanded">
  {#snippet template(args)}
    <div class="w-52 surface-1 p-2"><ModuleSwitcher {...args} /></div>
  {/snippet}
</Story>

<Story name="Open" play={open}>
  {#snippet template(args)}
    <div class="w-52 surface-1 p-2"><ModuleSwitcher {...args} /></div>
  {/snippet}
</Story>

<Story name="Busy ring" args={{ busy: true }}>
  {#snippet template(args)}
    <div class="w-52 surface-1 p-2"><ModuleSwitcher {...args} /></div>
  {/snippet}
</Story>

<Story name="Collapsed rail (expand affordance)" args={{ collapsed: true }}>
  {#snippet template(args)}
    <div class="w-14 surface-1 p-2"><ModuleSwitcher {...args} /></div>
  {/snippet}
</Story>

<Story
  name="Personal org"
  parameters={{
    sveltekit_experimental: {
      state: { page: { data: { ...pageData, activeOrgKind: 'personal' } } },
    },
  }}
>
  {#snippet template(args)}
    <div class="w-52 surface-1 p-2"><ModuleSwitcher {...args} /></div>
  {/snippet}
</Story>
