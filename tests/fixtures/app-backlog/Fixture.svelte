<script lang="ts">
  import { provideViewMemory } from '$lib/shell/view-context';
  import { provideDropRegistry } from '$lib/shell/drop-context.svelte';
  import { page } from '$app/state';
  import DataTable from '$lib/components/data-table/DataTable.svelte';
  import GlobalDropTarget from '$lib/components/layout/GlobalDropTarget.svelte';
  import DesktopTitlebar from '$lib/components/layout/DesktopTitlebar.svelte';
  import RecordContextMenu from '$lib/records/RecordContextMenu.svelte';
  import { Button } from '$lib/components/ui';
  import { Pencil, Upload } from 'lucide-svelte';
  import { createOptimistic } from '$lib/utils/optimistic';
  import { Toggle } from '$lib/components/ui';
  const memory = provideViewMemory();
  const drops = provideDropRegistry();
  memory.reconcile(JSON.stringify(['actor', 'org']));
  let module = $state('crm');
  let actions = $state(0);
  let received = $state<string[]>([]);
  let committed = $state(false);
  let reject = $state(false);
  const optimistic = createOptimistic<boolean>();
  drops.register({
    id: 'fixture-record',
    label: 'Current record (fixture)',
    available: () => true,
    receive: async (files) => {
      received = files.map((file) => file.name);
    },
  });
  const rename = [
    {
      id: 'rename',
      label: 'Rename',
      icon: Pencil,
      run: () => {
        actions += 1;
      },
    },
  ];
  function navigate() {
    memory.capture();
    module = module === 'crm' ? 'pos' : 'crm';
    page.url.pathname = module === 'crm' ? '/crm' : '/pos';
  }
  async function toggle(value: boolean) {
    await optimistic.run('toggle', value, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (reject) return false;
      committed = value;
      return true;
    });
  }
</script>

<DesktopTitlebar />
<main>
  <h1 class="t-heading">Hub app backlog · executable fixture</h1>
  <p class="t-body">
    Production components with synthetic records and simulated upload/write responses. No business
    data.
  </p>
  <nav>
    <Button onclick={navigate}>Switch module</Button><Button onclick={() => (drops.open = true)}
      ><Upload />Files</Button
    >
  </nav>
  <p class="t-body">Module: {module} · Actions: {actions}</p>
  <div class="controls">
    <Toggle
      ariaLabel="Instant edit"
      checked={optimistic.get('toggle', committed)}
      pending={optimistic.isPending('toggle')}
      onchange={toggle}
    />
    <Toggle label="Reject next write" bind:checked={reject} />
  </div>
  {#if module === 'crm'}
    <DataTable
      variant="plain"
      storageKey="fixture-customers"
      data={[
        { id: 'one', name: 'Alpha' },
        { id: 'two', name: 'Beta' },
      ]}
      columns={[{ key: 'name', label: 'Name' }]}
      getRowId={(row) => row.id}
      searchable
      selectable
      rowContextMenu={() => rename}
    />
  {:else}<p class="t-body">Other module. Return to restore filters and selection.</p>{/if}
  <RecordContextMenu actions={rename}
    ><article class="card">
      <h2 class="t-title">Record card</h2>
      <p class="t-body">Right-click or press Shift+F10.</p>
      <Button onclick={() => (actions += 1)}>Rename</Button>
    </article></RecordContextMenu
  >
  <p class="t-body" role="status">Received files: {received.join(', ') || 'none'}</p>
</main>
<GlobalDropTarget />

<style>
  main {
    padding: var(--space-6);
    max-width: 64rem;
    margin-inline: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  nav,
  .controls {
    display: flex;
    gap: var(--space-4);
    flex-wrap: wrap;
  }
  .card {
    padding: var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
  }
</style>
