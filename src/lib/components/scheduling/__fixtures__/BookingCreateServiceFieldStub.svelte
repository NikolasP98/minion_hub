<script lang="ts">
  import type { SchedulableService } from '../ServicePickerField.svelte';
  import { Button } from '$lib/components/ui';

  let {
    services,
    value = $bindable(''),
    onchange,
  }: {
    services: SchedulableService[];
    value?: string;
    onchange?: (id: string) => void;
  } = $props();

  function chooseFirst() {
    value = services[0]?.id ?? '';
    onchange?.(value);
  }
</script>

<Button type="button" onclick={chooseFirst}>Select Consulta</Button>
