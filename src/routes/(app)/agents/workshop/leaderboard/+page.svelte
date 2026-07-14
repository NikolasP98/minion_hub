<script lang="ts">
  import LeaderboardTab from '$lib/components/workshop/experiments/LeaderboardTab.svelte';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
</script>

<PageShell
  archetype="collection"
  scroll="region"
  variant="canvas"
  labelledBy="workshop-leaderboard-title"
>
  <PageBody padding="none" scroll="none"><LeaderboardTab /></PageBody>
</PageShell>
