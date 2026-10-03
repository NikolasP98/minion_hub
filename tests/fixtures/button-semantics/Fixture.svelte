<script lang="ts">
  import { Button } from '@minion-stack/ui';
  import FlowExports from '$lib/components/flow-editor/FlowExports.svelte';
  let disabled = $state(false);
  let loading = $state(false);
  let role = $state<'switch' | 'radio'>('switch');
  let count = $state(0);
  let submits = $state(0);
  let resets = $state(0);
  let links = $state(0);
</script>

<main>
  <header>
    <p class="eyebrow">Minion · shared control evidence</p>
    <h1>Keyboard and control semantics</h1>
    <p>Actual packed Button and FlowExports components. Synthetic data; no production session.</p>
  </header>
  <section aria-label="Roving focus">
    <h2>Roving focus</h2>
    <p>Tab should reach Selected option and skip Unselected option.</p>
    <div role="listbox" aria-label="Report format" class="row">
      <Button id="skip" role="option" aria-selected={false} tabindex={-1}>Unselected option</Button>
      <Button id="reach" role="option" aria-selected={true} tabindex={0}>Selected option</Button>
    </div>
  </section>
  <section aria-label="Reactive control">
    <h2>Reactive control</h2>
    <div class="row">
      <Button
        id="probe"
        {role}
        {disabled}
        {loading}
        tabindex={0}
        aria-checked={count % 2 === 1}
        onclick={() => count++}>Report switch</Button
      >
      <Button id="enabled-link" href="#local-destination" onclick={() => links++}>Local link</Button
      >
      <Button id="disabled-link" href="#disabled-destination" disabled tabindex={0}
        >Disabled link</Button
      >
      <Button id="loading-link" href="#loading-destination" loading tabindex={0}
        >Loading link</Button
      >
    </div>
    <p aria-live="polite">
      Activations: <output id="activations">{count}</output> · Link activations:
      <output id="links">{links}</output>
    </p>
    <div class="row">
      <Button
        id="disable"
        onclick={() => {
          disabled = true;
          loading = false;
        }}>Disable probe</Button
      >
      <Button
        id="load"
        onclick={() => {
          disabled = false;
          loading = true;
        }}>Load probe</Button
      >
      <Button
        id="enable"
        onclick={() => {
          disabled = false;
          loading = false;
        }}>Enable probe</Button
      >
      <Button
        id="role"
        onclick={() => {
          role = role === 'switch' ? 'radio' : 'switch';
        }}>Change role</Button
      >
    </div>
  </section>
  <section aria-label="Native forms">
    <h2>Native forms</h2>
    <form
      onsubmit={(event) => {
        event.preventDefault();
        submits++;
      }}
      onreset={() => resets++}
    >
      <div class="row">
        <Button id="default">Default action</Button><Button id="submit" type="submit"
          >Submit fixture</Button
        ><Button id="reset" type="reset">Reset fixture</Button><Button
          id="disabled-submit"
          type="submit"
          disabled>Disabled submit</Button
        ><Button id="loading-submit" type="submit" loading>Loading submit</Button>
      </div>
    </form>
    <p>
      Submits: <output id="submits">{submits}</output> · Resets:
      <output id="resets">{resets}</output>
    </p>
  </section>
  <section aria-label="Actual flow export panel">
    <h2>Actual flow export panel</h2>
    <FlowExports
      flowId="flow/%2F/東京"
      canEdit={true}
      toggles={{}}
      specs={[{ key: 'report/%2F', label: 'Report', type: 'string' }]}
    />
    <p>Writes below are captured in memory and return a synthetic success.</p>
    <pre id="requests">[]</pre>
  </section>
  <div id="local-destination">Local navigation target</div>
</main>

<style>
  main {
    max-width: 960px;
    margin: 0 auto;
    padding: var(--space-6);
    color: var(--color-text-primary);
  }
  header {
    margin-bottom: var(--space-6);
  }
  h1 {
    font-size: var(--font-size-display);
    font-weight: var(--font-weight-bold);
  }
  h2 {
    font-size: var(--font-size-section-title);
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
    padding: var(--space-4);
    margin-bottom: var(--space-4);
    min-width: 0;
  }
  .row {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: var(--font-size-caption);
  }
</style>
