<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import {
    Home,
    Users,
    Calendar,
    Package,
    Wallet,
    Settings,
    BarChart3,
    Inbox,
  } from 'lucide-svelte';
  import SideNav from '$lib/components/ui/SideNav.svelte';

  const flat = [
    { id: 'home', label: 'Home', icon: Home, href: '#home' },
    { id: 'customers', label: 'Customers', icon: Users, href: '#customers', badge: 12 },
    { id: 'calendar', label: 'Calendar', icon: Calendar, href: '#calendar' },
    { id: 'stock', label: 'Stock', icon: Package, href: '#stock', dot: true },
    { id: 'finances', label: 'Finances', icon: Wallet, href: '#finances', disabled: true },
    { id: 'settings', label: 'Settings', icon: Settings, href: '#settings', adminOnly: true },
  ];

  const grouped = [
    { label: 'Flows', items: flat.slice(0, 4) },
    { label: 'Setup', adminOnly: true, items: flat.slice(4) },
    {
      label: 'Reports',
      items: [
        { id: 'reports', label: 'Daily report', icon: BarChart3, href: '#r' },
        { id: 'inbox', label: 'Inbox', icon: Inbox, badge: '99+' },
      ],
    },
  ];

  const nested = [
    { id: 'crm', label: 'CRM', icon: Users, href: '#crm' },
    { id: 'crm-contacts', label: 'Contacts', href: '#crm/contacts', indent: 1 },
    { id: 'crm-tags', label: 'Tags', href: '#crm/tags', indent: 1 },
    { id: 'crm-insights', label: 'Insights', href: '#crm/insights', indent: 1, badge: 3 },
    { id: 'stock', label: 'Stock', icon: Package, href: '#stock' },
    { id: 'stock-items', label: 'Items', href: '#stock/items', indent: 1 },
  ];

  const many = Array.from({ length: 40 }, (_, i) => ({
    id: `item-${i + 1}`,
    label: i % 7 === 3 ? `A much longer navigation label number ${i + 1}` : `Section ${i + 1}`,
    icon: [Home, Users, Calendar, Package][i % 4],
    href: `#item-${i + 1}`,
    keywords: i % 5 === 0 ? 'alpha beta' : undefined,
  }));

  const { Story } = defineMeta({
    title: 'Atoms/Layout/SideNav',
    component: SideNav,
    tags: ['autodocs'],
    argTypes: { dividers: { control: 'boolean' }, leftBorder: { control: 'boolean' } },
    args: {
      items: flat,
      activeId: 'customers',
      ariaLabel: 'Example nav',
      dividers: true,
      leftBorder: false,
      onSelect: fn(),
    },
  });
</script>

<Story name="Flat items">
  {#snippet template(args)}
    <div class="w-56 h-80 flex surface-1"><SideNav {...args} /></div>
  {/snippet}
</Story>

<Story name="Grouped" args={{ items: grouped, activeId: 'stock' }}>
  {#snippet template(args)}
    <div class="w-56 h-96 flex surface-1"><SideNav {...args} /></div>
  {/snippet}
</Story>

<Story name="Badges, dot, admin tag, disabled" args={{ activeId: 'home' }}>
  {#snippet template(args)}
    <div class="w-56 h-80 flex surface-1"><SideNav {...args} /></div>
  {/snippet}
</Story>

<Story name="Nested (indent)" args={{ items: nested, activeId: 'crm-tags' }}>
  {#snippet template(args)}
    <div class="w-56 h-80 flex surface-1"><SideNav {...args} /></div>
  {/snippet}
</Story>

<Story name="Many items (scrolls)" args={{ items: many, activeId: 'item-17' }}>
  {#snippet template(args)}
    <div class="w-56 h-80 flex surface-1"><SideNav {...args} /></div>
  {/snippet}
</Story>

<Story
  name="With search"
  args={{
    items: many,
    activeId: 'item-2',
    search: { enabled: true, placeholder: 'Filter sections' },
    searchQuery: 'alpha',
  }}
>
  {#snippet template(args)}
    <div class="w-56 h-80 flex surface-1"><SideNav {...args} /></div>
  {/snippet}
</Story>

<Story
  name="Header + footer"
  args={{ header: 'Point of sale', items: grouped, activeId: 'calendar' }}
>
  {#snippet template(args)}
    <div class="w-56 h-96 flex surface-1">
      <SideNav {...args}>
        {#snippet footer()}
          <div class="p-2 text-xs text-muted-foreground border-t border-[var(--hairline)]">
            Shift open since 09:00
          </div>
        {/snippet}
      </SideNav>
    </div>
  {/snippet}
</Story>

<Story
  name="Left-border indicator"
  args={{ leftBorder: true, items: grouped, activeId: 'customers' }}
>
  {#snippet template(args)}
    <div class="w-56 h-96 flex surface-1"><SideNav {...args} /></div>
  {/snippet}
</Story>

<Story
  name="Buttons (no href, onSelect)"
  args={{ items: flat.map(({ href, ...i }) => i), activeId: 'calendar' }}
>
  {#snippet template(args)}
    <div class="w-56 h-80 flex surface-1"><SideNav {...args} /></div>
  {/snippet}
</Story>

<Story name="Narrow (collapsed-width host)" args={{ items: flat, activeId: 'home' }}>
  {#snippet template(args)}
    <div class="w-14 h-80 flex surface-1 overflow-hidden"><SideNav {...args} /></div>
  {/snippet}
</Story>

<Story name="Empty" args={{ items: [] }}>
  {#snippet template(args)}
    <div class="w-56 h-40 flex surface-1"><SideNav {...args} /></div>
  {/snippet}
</Story>

<!-- Responsive: labels and headers show from xl (1280px); below that the nav is a 56px icon rail. -->
<Story
  name="Grouped · Phone"
  args={{ items: grouped, activeId: 'stock' }}
  globals={{ viewport: { value: 'phone', isRotated: false } }}
>
  {#snippet template(args)}
    <div class="h-96 flex surface-1"><SideNav {...args} /></div>
  {/snippet}
</Story>

<Story
  name="Grouped · Tablet"
  args={{ items: grouped, activeId: 'stock' }}
  globals={{ viewport: { value: 'tablet', isRotated: false } }}
>
  {#snippet template(args)}
    <div class="h-96 flex surface-1"><SideNav {...args} /></div>
  {/snippet}
</Story>
