<script lang="ts">
  import SectionNav from './SectionNav.svelte';

  const items = [
    { id: 'dashboard', label: 'Dashboard', href: '/crm' },
    { id: 'insights', label: 'Insights', href: '/crm/insights', indent: 1 },
  ];
</script>

{#snippet footer()}<span>Open shift</span>{/snippet}

<SectionNav {items} activeId="insights" ariaLabel="Operations" {footer} />
