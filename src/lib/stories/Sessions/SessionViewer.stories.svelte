<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import SessionViewer from '$lib/components/sessions/SessionViewer.svelte';

  // Messages are fetched through the server/gateway (no props for them), so with a key
  // the viewer lands on its error state; the header still renders from `session`.
  const session = {
    id: 's1',
    serverId: 'srv-1',
    agentId: 'panik',
    sessionKey: 'agent:panik:whatsapp:dm:+51999888777',
    status: 'idle',
    metadata: JSON.stringify({ displayName: 'Ana Torres', totalTokens: 48_210 }),
    createdAt: Date.now() - 3 * 86_400_000,
    updatedAt: Date.now() - 25 * 60_000,
  };

  const { Story } = defineMeta({
    title: 'Components/Sessions/SessionViewer',
    component: SessionViewer,
    tags: ['autodocs'],
    args: { serverId: null, sessionKey: null, session: null },
  });
</script>

<Story name="No session selected">
  {#snippet template(args)}<div class="w-[36rem] h-96 flex flex-col">
      <SessionViewer {...args} />
    </div>{/snippet}
</Story>

<Story
  name="Selected fetch fails"
  args={{ serverId: 'srv-1', sessionKey: 'agent:panik:whatsapp:dm:+51999888777', session }}
>
  {#snippet template(args)}<div class="w-[36rem] h-96 flex flex-col">
      <SessionViewer {...args} />
    </div>{/snippet}
</Story>
