<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import NavContextMenu from '$lib/components/layout/NavContextMenu.svelte';
  import { EMPTY_NAV_CONFIG } from '$lib/nav/custom-sections';
  import { Button } from '$lib/components/ui';

  // Same shape as NavContextMenu.mounted.test.ts: permissions come from page.data.
  const navConfig = {
    ...EMPTY_NAV_CONFIG,
    sections: [
      {
        id: 'st4ff1',
        slug: 'staff',
        label: 'Staff',
        pages: [
          { id: 'k3x9q2', kind: 'link', slug: 'sell', label: 'Sell', target: '/pos/sell' },
          {
            id: 'a1b2c3',
            kind: 'main',
            slug: 'appts',
            label: 'Appts',
            target: '/pos/appointments',
          },
        ],
      },
    ],
  };
  const data = (perms) => ({
    sveltekit_experimental: {
      state: {
        page: {
          data: {
            navConfig,
            preferences: { preferences: { landingPage: '/home' } },
            permissions: { permissions: perms },
          },
        },
      },
    },
  });

  const { Story } = defineMeta({
    title: 'Navigation/NavContextMenu',
    component: NavContextMenu,
    tags: ['autodocs'],
    parameters: {
      docs: { story: { inline: false, height: '360px' } },
      ...data(['settings:manage']),
    },
    args: { kind: 'item', href: '/pos/sell', label: 'Sell' },
  });

  const rightClick = async ({ canvas, userEvent }) => {
    await userEvent.pointer({ keys: '[MouseRight]', target: canvas.getByTestId('row') });
  };
  const rowCls =
    'block px-3 py-1.5 rounded-[var(--radius-sm)] text-sm text-foreground hover:bg-bg3';
</script>

<Story name="Item (built-in page, editor)" play={rightClick}>
  {#snippet template(args)}
    <NavContextMenu {...args}
      ><Button variant="ghost" data-testid="row" class={rowCls}>Sell</Button></NavContextMenu
    >
  {/snippet}
</Story>

<Story
  name="Item (custom instance link)"
  args={{ href: '/staff/sell~k3x9q2', label: 'Sell' }}
  play={rightClick}
>
  {#snippet template(args)}
    <NavContextMenu {...args}
      ><Button variant="ghost" data-testid="row" class={rowCls}>Sell (alias)</Button
      ></NavContextMenu
    >
  {/snippet}
</Story>

<Story
  name="Custom section header"
  args={{ kind: 'header', sectionId: 'custom:st4ff1', label: 'Staff' }}
  play={rightClick}
>
  {#snippet template(args)}
    <NavContextMenu {...args}
      ><span data-testid="row" class="{rowCls} uppercase text-xs text-muted-foreground">Staff</span
      ></NavContextMenu
    >
  {/snippet}
</Story>

<Story name="Empty nav area" args={{ kind: 'area' }} play={rightClick}>
  {#snippet template(args)}
    <NavContextMenu {...args}>
      <div
        data-testid="row"
        class="h-40 rounded-[var(--radius-md)] border border-dashed border-border text-xs text-muted-foreground flex items-center justify-center"
      >
        Right-click the empty area
      </div>
    </NavContextMenu>
  {/snippet}
</Story>

<Story name="Member (set-as-home only)" play={rightClick} parameters={data([])}>
  {#snippet template(args)}
    <NavContextMenu {...args}
      ><Button variant="ghost" data-testid="row" class={rowCls}>Sell</Button></NavContextMenu
    >
  {/snippet}
</Story>

<Story name="Trigger (idle)">
  {#snippet template(args)}
    <NavContextMenu {...args}
      ><Button variant="ghost" class={rowCls}>Right-click, Shift+F10 or long-press</Button
      ></NavContextMenu
    >
  {/snippet}
</Story>
