<script lang="ts">
  import type { LucideIcon } from '$lib/plugins/icon-map';
  import { BRAND_ICON_SET, PLUGIN_ICON_MAP } from '$lib/plugins/icon-map';
  import ChannelBrandIcon from '$lib/components/channels/ChannelBrandIcon.svelte';
  import { Puzzle } from 'lucide-svelte';

  interface Props {
    icon: LucideIcon | string;
    size?: number;
    class?: string;
  }

  let { icon, size = 18, class: className = '' }: Props = $props();

  const isEmoji = (s: string) => /\p{Extended_Pictographic}/u.test(s);
</script>

{#if typeof icon === 'string'}
  {#if isEmoji(icon)}
    <span class={className}>{icon}</span>
  {:else if BRAND_ICON_SET.has(icon)}
    <ChannelBrandIcon channel={icon} size={size} class={className} />
  {:else if PLUGIN_ICON_MAP[icon]}
    {@const IconComp = PLUGIN_ICON_MAP[icon]}
    <IconComp {size} class={className} />
  {:else}
    <Puzzle {size} class={className} />
  {/if}
{:else}
  <icon {size} class={className} />
{/if}
