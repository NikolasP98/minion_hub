<script lang="ts">
  import { getBranding } from '$lib/branding.svelte';
  import BuilderHub from '$lib/components/builder/BuilderHub.svelte';
</script>

<svelte:head>
  <title>Tools · {getBranding().name}</title>
</svelte:head>

<BuilderHub only="tools" />
