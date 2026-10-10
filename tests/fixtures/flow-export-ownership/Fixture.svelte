<script lang="ts">
  import { onMount } from 'svelte';
  import FlowExports from '$lib/components/flow-editor/FlowExports.svelte';
  import { toaster } from '$lib/state/ui/toast.svelte';

  const specs = [
    { key: 'report', label: 'Report', type: 'string' as const },
    { key: 'summary', label: 'Summary', type: 'string' as const },
  ];
  // Synthetic committed data per flow, as page.data.flowTogglesByFlow would carry it.
  let data = $state<Record<string, Record<string, boolean>>>({
    A: { report: true },
    B: { report: false },
  });
  let flowId = $state('A');
  let canEdit = $state(true);
  let toasts = $state(0);

  // zag publishes one toast event per create/dismiss; count the creations.
  onMount(() =>
    toaster.subscribe((t: { dismiss?: boolean }) => {
      if (!t.dismiss) toasts++;
    }),
  );
  // Harness hooks: prop replacement and reloaded data go through Svelte state.
  Object.assign(window, {
    __hc040Toasts: () => toaster.getCount(),
    __hc040Select: (id: string) => (flowId = id),
    __hc040Load: (id: string, toggles: Record<string, boolean>) =>
      (data = { ...data, [id]: toggles }),
    __hc040CanEdit: (v: boolean) => (canEdit = v),
  });
</script>

<main>
  <header>
    <p class="eyebrow">Minion · flow export ownership evidence (HC-040)</p>
    <h1>Exported variables across flows</h1>
    <p>Actual FlowExports component. Synthetic flow data; replies are parked until settled.</p>
  </header>
  <section aria-label="Selected flow">
    <div class="row" role="group" aria-label="Select flow">
      <button
        id="select-a"
        type="button"
        aria-pressed={flowId === 'A'}
        onclick={() => (flowId = 'A')}>Flow A</button
      >
      <button
        id="select-b"
        type="button"
        aria-pressed={flowId === 'B'}
        onclick={() => (flowId = 'B')}>Flow B</button
      >
    </div>
    <p>
      Showing <output id="flow">{flowId}</output> · Error toasts:
      <output id="toasts">{toasts}</output>
    </p>
  </section>
  <section aria-label="Exports panel" id="panel">
    <FlowExports {flowId} {specs} toggles={data[flowId] ?? {}} {canEdit} />
  </section>
  <section aria-label="Requests">
    <h2>PATCH requests</h2>
    <pre id="requests">[]</pre>
  </section>
</main>

<style>
  main {
    max-width: 720px;
    margin: 0 auto;
    padding: var(--space-4);
    color: var(--color-text-primary);
  }
  header {
    margin-bottom: var(--space-4);
  }
  h1 {
    font-size: var(--font-size-section-title);
    font-weight: var(--font-weight-semibold);
  }
  h2 {
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-semibold);
    margin-bottom: var(--space-2);
  }
  p {
    color: var(--color-text-secondary);
    margin: var(--space-2) 0;
  }
  .eyebrow {
    color: var(--color-accent);
  }
  section {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
    padding: var(--space-3);
    margin-bottom: var(--space-3);
    min-width: 0;
  }
  .row {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  button {
    min-height: var(--control-height-touch);
    padding: 0 var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
  }
  button[aria-pressed='true'] {
    background: var(--color-accent);
    color: var(--color-on-accent);
  }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: var(--font-size-caption);
  }
</style>
