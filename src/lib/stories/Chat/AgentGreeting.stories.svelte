<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import AgentGreeting from '$lib/components/my-agent/AgentGreeting.svelte';

  // `userName` is declared in Props but unused by the component today.
  const { Story } = defineMeta({
    title: 'Components/Chat/AgentGreeting',
    component: AgentGreeting,
    tags: ['autodocs'],
    args: { greeting: 'Good morning, Ana. Three bookings today and one invoice overdue.' },
  });
</script>

<Story name="Default" />
<Story name="Short" args={{ greeting: 'Hi.' }} />
<Story
  name="Long"
  args={{
    greeting:
      'Good morning, Ana. You have three bookings today (10:00 Luis Paredes, 12:30 Marta Ríos, 16:00 a new contact from Instagram), one invoice twelve days overdue, two stock items under their minimum, and the Friday booking you asked me to move is now on Monday. Anything first?',
  }}
/>

<Story name="Narrow host">
  {#snippet template(args)}<div class="w-56"><AgentGreeting {...args} /></div>{/snippet}
</Story>
