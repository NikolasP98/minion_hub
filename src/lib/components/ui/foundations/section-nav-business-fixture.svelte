<script lang="ts">
  import SectionNav from './SectionNav.svelte';

  const items = [
    { id: 'dashboard', label: 'Dashboard', href: '/operations' },
    { id: 'insights', label: 'Insights', href: '/operations/insights', indent: 1 },
  ];
</script>

{#snippet footer()}<span>Open shift</span>{/snippet}

<SectionNav {items} activeId="insights" ariaLabel="Operations" {footer} />
