<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import SchedulingNav from '$lib/components/scheduling/SchedulingNav.svelte';

  // Items come from the module registry filtered by `page.data` access, so the
  // mocked page carries an admin with every scheduling grant.
  const pageData = {
    user: { role: 'admin' },
    permissions: {
      permissions: [
        'scheduling:view',
        'scheduling:create',
        'scheduling:update',
        'scheduling:delete',
      ],
    },
    activeOrgKind: 'business',
  };
  const at = (pathname: string) => ({
    sveltekit_experimental: {
      state: { page: { url: new URL(`http://localhost${pathname}`), data: pageData } },
    },
  });

  const { Story } = defineMeta({
    title: 'Components/Calendar/SchedulingNav',
    component: SchedulingNav,
    tags: ['autodocs'],
    parameters: at('/scheduling/calendar'),
  });
</script>

<Story name="Calendar active" />
<Story name="Dashboard active" parameters={at('/scheduling')} />
<Story name="Bookings active" parameters={at('/scheduling/bookings')} />
<Story
  name="Viewer (no page data)"
  parameters={{
    sveltekit_experimental: {
      state: { page: { url: new URL('http://localhost/scheduling'), data: {} } },
    },
  }}
/>
