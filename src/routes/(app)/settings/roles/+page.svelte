<script lang="ts">
  import RbacRolesSection from '$lib/components/users/RbacRolesSection.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<RbacRolesSection
  roles={data.roles}
  actions={data.actions}
  businessModules={data.businessModules}
  adminModules={data.adminModules}
/>
