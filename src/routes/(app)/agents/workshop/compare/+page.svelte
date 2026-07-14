<script lang="ts">
  import CompareTab from '$lib/components/workshop/experiments/CompareTab.svelte';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
</script>

<PageShell
  archetype="workspace"
  scroll="region"
  variant="canvas"
  labelledBy="workshop-compare-title"
>
  <PageBody padding="none" scroll="none"><CompareTab /></PageBody>
</PageShell>
