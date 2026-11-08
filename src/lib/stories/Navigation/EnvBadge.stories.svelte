<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import EnvBadge from '$lib/components/layout/EnvBadge.svelte';

  const env = (e) => ({ sveltekit_experimental: { state: { page: { data: { env: e } } } } });

  const { Story } = defineMeta({
    title: 'Navigation/EnvBadge',
    component: EnvBadge,
    tags: ['autodocs'],
    parameters: env({ backend: 'dev', local: true }),
  });
</script>

<Story name="DEV">
  {#snippet template()}<EnvBadge />{/snippet}
</Story>

<Story name="PRD (local server on production backend)" parameters={env({ backend: 'prd', local: true })}>
  {#snippet template()}<EnvBadge />{/snippet}
</Story>

<Story name="Deployed PRD (hidden)" parameters={env({ backend: 'prd', local: false })}>
  {#snippet template()}
    <p class="text-xs text-muted-foreground">Nothing renders on a deployed production backend.</p>
    <EnvBadge />
  {/snippet}
</Story>
