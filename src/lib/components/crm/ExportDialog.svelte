<!-- Moved to $lib/components/data-table/ExportDialog.svelte (it is a DataTable
     internal with no CRM content). This shim keeps the old import path alive
     for one release. -->
<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import ExportDialog from '$lib/components/data-table/ExportDialog.svelte';

  let { open = $bindable(false), ...rest }: ComponentProps<typeof ExportDialog> = $props();
</script>

<ExportDialog bind:open {...rest} />
