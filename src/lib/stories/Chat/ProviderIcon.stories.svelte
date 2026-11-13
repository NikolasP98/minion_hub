<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { iconSizes } from '$lib/components/ui';
  import ProviderIcon from '$lib/components/my-agent/ProviderIcon.svelte';
  import type { ProviderKey } from '$lib/components/my-agent/provider';

  const PROVIDERS: ProviderKey[] = ['gmail', 'outlook', 'apple', 'mail'];

  const { Story } = defineMeta({
    title: 'Components/Chat/ProviderIcon',
    component: ProviderIcon,
    tags: ['autodocs'],
    argTypes: {
      provider: { control: 'select', options: PROVIDERS },
      size: { control: { type: 'range', min: 8, max: 64, step: 1 } },
    },
    args: { provider: 'gmail', size: 13 },
  });
</script>

<Story name="Gmail" />
<Story name="Outlook" args={{ provider: 'outlook' }} />
<Story name="Apple" args={{ provider: 'apple' }} />
<Story name="Generic mail fallback" args={{ provider: 'mail' }} />

<Story name="All providers">
  {#snippet template(args)}
    <div class="flex items-center gap-6">
      {#each PROVIDERS as provider (provider)}
        <div class="flex flex-col items-center gap-2">
          <ProviderIcon {...args} {provider} size={iconSizes.lg} />
          <span class="t-caption text-muted-foreground">{provider}</span>
        </div>
      {/each}
    </div>
  {/snippet}
</Story>

<Story name="Sizes 10 to 48">
  {#snippet template(args)}
    <div class="flex items-end gap-4">
      {#each [10, 13, 16, 24, 32, 48] as size (size)}
        <ProviderIcon {...args} {size} />
      {/each}
    </div>
  {/snippet}
</Story>
