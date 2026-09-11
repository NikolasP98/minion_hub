<script lang="ts">
  import CallControls from '$lib/components/my-agent/CallControls.svelte';
  let active = $state(false);
  let muted = $state(false);
  let disabled = $state(false);
  let starts = $state(0);
  let ends = $state(0);
  let toggles = $state(0);
</script>

<main class="calls-fixture">
  <h1>Call controls fixture</h1>
  <label><input type="checkbox" bind:checked={disabled} /> Disable starting calls</label>
  <section aria-label="Synthetic call controls">
    <CallControls
      {active}
      {muted}
      {disabled}
      status={muted ? 'idle' : 'listening'}
      onstart={() => {
        starts += 1;
        active = true;
      }}
      onend={() => {
        ends += 1;
        active = false;
      }}
      ontoggleMute={() => {
        toggles += 1;
        muted = !muted;
      }}
    />
  </section>
  <output aria-label="Synthetic callback counts"
    >{starts} starts; {toggles} toggles; {ends} ends</output
  >
</main>

<style>
  .calls-fixture {
    padding: var(--space-4);
    max-width: 100%;
  }
  section {
    margin-block: var(--space-4);
  }
</style>
