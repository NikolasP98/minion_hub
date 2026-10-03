<script lang="ts">
  import Before from './Before.svelte';
  import SettingsNav from '$lib/components/settings/SettingsNav.svelte';
  import { page } from './app-state.svelte';
  const viewOnly = new URLSearchParams(location.search).get('role') === 'viewer';
  page.data.permissions.permissions = viewOnly ? ['comms:view'] : ['comms:manage'];
</script>

<main>
  <h1>Notification settings access</h1>
  <p>
    Synthetic {viewOnly ? 'viewer' : 'organization manager'}, ordinary user role. Actual SettingsNav
    and SectionNav components; current shared route policy. No production session or delivery.
  </p>
  <div class="comparison">
    <section>
      <h2>Before · historical admin-only entry</h2>
      <Before />
    </section>
    <section>
      <h2>After · current capability</h2>
      <SettingsNav />
    </section>
  </div>
</main>

<style>
  main {
    padding: var(--space-6);
    color: var(--color-text-primary);
    background: var(--color-canvas);
    min-height: 100vh;
  }
  h1 {
    font-size: var(--font-size-page-title);
    margin-bottom: var(--space-3);
  }
  h2 {
    font-size: var(--font-size-section-title);
    margin-bottom: var(--space-4);
  }
  p {
    color: var(--color-text-secondary);
    margin-bottom: var(--space-6);
    max-width: var(--page-max);
  }
  .comparison {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-6);
  }
  section {
    min-width: 0;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
  }
  @media (max-width: 767px) {
    .comparison {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
