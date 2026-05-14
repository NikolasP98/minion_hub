<script lang="ts">
  import RolesSection from '$lib/components/users/RolesSection.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<RolesSection initialRoles={data.roles} initialCatalog={data.catalog} />
