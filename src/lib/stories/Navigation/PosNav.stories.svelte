<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import PosNav from '$lib/components/pos/PosNav.svelte';

  // Pages come from the module registry gated by page.data; the footer
  // ShiftBanner reads the POS layout's settings + open shift.
  const base = {
    user: { id: 'u-1', role: 'admin' },
    permissions: { permissions: ['settings:manage', 'pos:sell', 'pos:manage'], roles: ['owner'] },
    activeOrgKind: 'business',
    schedulingEnabled: true,
    posSettings: { methods: [] },
    openShift: null,
    openShifts: [],
    openerName: null,
  };
  const data = (d) => ({
    sveltekit_experimental: {
      state: { page: { data: { ...base, ...d }, url: new URL('http://localhost/pos/sell') } },
    },
  });

  const { Story } = defineMeta({
    title: 'Navigation/PosNav',
    component: PosNav,
    tags: ['autodocs'],
    parameters: data({}),
  });
</script>

<Story name="On /pos/sell">
  {#snippet template()}
    <div class="w-56 h-[480px] flex surface-1"><PosNav /></div>
  {/snippet}
</Story>

<Story name="Scheduling disabled" parameters={data({ schedulingEnabled: false })}>
  {#snippet template()}
    <div class="w-56 h-[480px] flex surface-1"><PosNav /></div>
  {/snippet}
</Story>

<Story
  name="Member permissions"
  parameters={data({
    user: { id: 'u-2', role: 'user' },
    permissions: { permissions: ['pos:sell'], roles: ['staff'] },
  })}
>
  {#snippet template()}
    <div class="w-56 h-[480px] flex surface-1"><PosNav /></div>
  {/snippet}
</Story>
