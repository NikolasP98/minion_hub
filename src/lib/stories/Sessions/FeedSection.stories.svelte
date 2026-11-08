<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import FeedSection from '$lib/components/my-agent/FeedSection.svelte';
  import FeedCard from '$lib/components/my-agent/FeedCard.svelte';

  const items = Array.from({ length: 12 }, (_, i) => ({
    title: ['Ana Torres asked to move her cleaning', 'Supplier confirmed the resin order', 'Reminder bounced for +51 999 888 777', 'New review on Google Maps'][i % 4],
    subtitle: `${(i + 1) * 7} min ago`,
  }));

  const { Story } = defineMeta({
    title: 'Sessions/FeedSection',
    component: FeedSection,
    tags: ['autodocs'],
    argTypes: { scrollable: { control: 'boolean' }, collapsible: { control: 'boolean' }, collapsed: { control: 'boolean' } },
    args: { label: 'Inbox', count: 3, scrollable: false, collapsible: false, collapsed: false, providers: [] },
  });
</script>

<Story name="Three items">
  {#snippet template(args)}
    <div class="w-80">
      <FeedSection {...args}>
        {#each items.slice(0, 3) as it (it.subtitle)}<FeedCard {...it} />{/each}
      </FeedSection>
    </div>
  {/snippet}
</Story>

<Story name="Scrollable twelve items" args={{ count: 12, scrollable: true }}>
  {#snippet template(args)}
    <div class="w-80 h-64 flex flex-col">
      <FeedSection {...args}>
        {#each items as it (it.subtitle)}<FeedCard {...it} />{/each}
      </FeedSection>
    </div>
  {/snippet}
</Story>

<Story name="With providers" args={{ label: 'Email', providers: ['gmail', 'outlook'] }}>
  {#snippet template(args)}
    <div class="w-80">
      <FeedSection {...args}>
        {#each items.slice(0, 3) as it (it.subtitle)}<FeedCard {...it} />{/each}
      </FeedSection>
    </div>
  {/snippet}
</Story>

<Story name="Collapsible expanded" args={{ collapsible: true }}>
  {#snippet template(args)}
    <div class="w-80">
      <FeedSection {...args}>
        {#snippet summary()}<p class="text-xs text-muted">3 unread, newest 7 min ago</p>{/snippet}
        {#each items.slice(0, 3) as it (it.subtitle)}<FeedCard {...it} />{/each}
      </FeedSection>
    </div>
  {/snippet}
</Story>

<Story name="Collapsible collapsed with summary" args={{ collapsible: true, collapsed: true }}>
  {#snippet template(args)}
    <div class="w-80">
      <FeedSection {...args}>
        {#snippet summary()}<p class="text-xs text-muted">3 unread, newest 7 min ago</p>{/snippet}
        {#each items.slice(0, 3) as it (it.subtitle)}<FeedCard {...it} />{/each}
      </FeedSection>
    </div>
  {/snippet}
</Story>

<Story name="Zero items" args={{ count: 0 }}>
  {#snippet template(args)}
    <div class="w-80">
      <FeedSection {...args}><p class="text-xs text-muted p-2">Nothing new.</p></FeedSection>
    </div>
  {/snippet}
</Story>
