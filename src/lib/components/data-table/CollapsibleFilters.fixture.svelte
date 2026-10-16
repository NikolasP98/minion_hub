<script lang="ts">
  import { Button } from '$lib/components/ui';
  import CollapsibleFilters from './CollapsibleFilters.svelte';
  let { activeCount = 0 }: { activeCount?: number } = $props();
</script>

<CollapsibleFilters {activeCount}>
  <span data-filter="staff"><Button variant="ghost" size="sm">Staff</Button></span>
  <span data-filter="kind"><Button variant="ghost" size="sm">Kind</Button></span>
  <span data-filter="status"><Button variant="ghost" size="sm">Status</Button></span>
</CollapsibleFilters>
