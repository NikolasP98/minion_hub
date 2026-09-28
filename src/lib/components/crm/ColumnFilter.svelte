<!-- Moved to $lib/components/data-table/ColumnFilter.svelte (it is a DataTable
     internal with no CRM content). This shim keeps the old import path alive
     for one release. -->
<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import ColumnFilter from '$lib/components/data-table/ColumnFilter.svelte';

  let { selected = $bindable(new Set<string>()), ...rest }: ComponentProps<typeof ColumnFilter> =
    $props();
</script>

<ColumnFilter bind:selected {...rest} />
