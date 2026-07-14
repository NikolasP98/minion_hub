<script lang="ts">
  import Modal from '../Modal.svelte';
  import Select from '../Select.svelte';
  import Skeleton from '../Skeleton.svelte';
  import Spinner from '../Spinner.svelte';
  import Tabs from '../Tabs.svelte';
  import Toggle from '../Toggle.svelte';

  let open = true;
  let selected = 'one';
  let enabled = false;
  let tab = 'details';
</script>

<Select
  label="First select"
  bind:value={selected}
  options={[{ value: 'one', label: 'One' }]}
  class="fixture-legacy-control"
  fieldClass="fixture-field"
  selectClass="fixture-explicit-control"
/>
<Select label="Second select" value={2} size="xs" options={[{ value: 2, label: 'Two' }]} />
<Toggle bind:checked={enabled} ariaLabel="Enable audit" description="Audits every change" />
<Spinner label="Loading fixture" />
<Skeleton width="12rem" height="1rem" rounded="rounded-full" />
<Tabs
  id="fixture-tabs"
  aria-label="Fixture sections"
  tabs={[{ value: 'details', label: 'Details' }]}
  bind:value={tab}
/>
<div id="fixture-tabs-panel-details" role="tabpanel" aria-labelledby="fixture-tabs-tab-details">
  Details
</div>
<Modal bind:open title="Fixture dialog">Dialog body</Modal>
