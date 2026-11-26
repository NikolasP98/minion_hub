<script lang="ts">
  import { getBranding } from '$lib/branding.svelte';
  import PromptShell from '$lib/components/prompt/PromptShell.svelte';
  import { PageHeader } from '$lib/components/ui';
  import PageBody from '$lib/components/ui/foundations/PageBody.svelte';
  import PageShell from '$lib/components/ui/foundations/PageShell.svelte';
  import * as m from '$lib/paraglide/messages';
</script>

<svelte:head>
  <title>Prompt Engineering · {getBranding().fullName}</title>
</svelte:head>

<PageShell archetype="workspace" scroll="none">
  <PageHeader documentTitle={false} title={m.nav_prompt()} subtitle={m.prompt_pipeline()} />
  <PageBody padding="none" scroll="none" class="prompt-body">
    <PromptShell />
  </PageBody>
</PageShell>

<style>
  :global(.prompt-body) {
    display: flex;
    flex-direction: column;
  }
</style>
