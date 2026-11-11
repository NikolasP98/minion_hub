<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import FeedCard from '$lib/components/my-agent/FeedCard.svelte';

  const { Story } = defineMeta({
    title: 'Components/Sessions/FeedCard',
    component: FeedCard,
    tags: ['autodocs'],
    args: {
      title: 'Ana Torres asked to move her Thursday cleaning',
      subtitle: 'WhatsApp · 12 min ago',
      icon: '💬',
    },
  });
</script>

<Story name="Title only" args={{ subtitle: undefined, icon: undefined }}>
  {#snippet template(args)}<div class="w-80"><FeedCard {...args} /></div>{/snippet}
</Story>

<Story name="With subtitle and icon">
  {#snippet template(args)}<div class="w-80"><FeedCard {...args} /></div>{/snippet}
</Story>

<Story name="With all actions" args={{ onreply: fn(), onsnooze: fn(), ondismiss: fn() }}>
  {#snippet template(args)}<div class="w-80"><FeedCard {...args} /></div>{/snippet}
</Story>

<Story name="Openable with dismiss" args={{ onopen: fn(), ondismiss: fn() }}>
  {#snippet template(args)}<div class="w-80"><FeedCard {...args} /></div>{/snippet}
</Story>

<Story
  name="Long title"
  args={{
    title:
      'The supplier confirmed the composite resin order but the delivery date moved to the week after next and they want a deposit before dispatch',
    subtitle: 'Email · from compras@proveedor-ejemplo.pe · yesterday',
    onopen: fn(),
    ondismiss: fn(),
  }}
>
  {#snippet template(args)}<div class="w-80"><FeedCard {...args} /></div>{/snippet}
</Story>
