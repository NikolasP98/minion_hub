<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import WelcomePanel from '$lib/components/layout/WelcomePanel.svelte';

  // No props: reads the gateway connection / hosts / ui stores, which default
  // to "not connected" outside the app.
  const { Story } = defineMeta({
    title: 'Components/Cards/WelcomePanel',
    component: WelcomePanel,
    tags: ['autodocs'],
  });
</script>

<Story name="Not connected">
  {#snippet template()}<div class="h-[32rem] flex"><WelcomePanel /></div>{/snippet}
</Story>
