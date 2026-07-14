<script lang="ts">
  import GroupChatTab from '$lib/components/workshop/experiments/GroupChatTab.svelte';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
</script>

<PageShell
  archetype="workspace"
  scroll="region"
  variant="canvas"
  labelledBy="workshop-groupchat-title"
>
  <PageBody padding="none" scroll="none"><GroupChatTab /></PageBody>
</PageShell>
