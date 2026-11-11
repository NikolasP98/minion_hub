<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import type { PlayFunction } from 'storybook/internal/types';
  import SessionDropdown from '$lib/components/sessions/SessionDropdown.svelte';
  import { gw } from '$lib/state/gateway/gateway-data.svelte';
  import { ui } from '$lib/state/ui/ui.svelte';

  const AGENT = 'panik';
  const now = Date.now();
  const k = (tail: string) => `agent:${AGENT}:${tail}`;
  const sessions: typeof gw.sessions = [
    { sessionKey: k('main'), updatedAt: now - 30_000 },
    {
      sessionKey: k('whatsapp:dm:+51999888777'),
      displayName: 'Ana Torres',
      updatedAt: now - 8 * 60_000,
    },
    { sessionKey: k('whatsapp:dm:+51988777666'), updatedAt: now - 3 * 3_600_000 },
    {
      sessionKey: k('cron:6f1d2c3b'),
      label: 'Nightly stock check',
      updatedAt: now - 20 * 3_600_000,
    },
    { sessionKey: k('workshop:conv:panik:faces-clinic'), updatedAt: now - 2 * 86_400_000 },
    { sessionKey: k('chat:0c1d2e3f-aaaa-bbbb-cccc-0123456789ab'), updatedAt: now - 9 * 86_400_000 },
  ];
  const status: typeof ui.sessionStatus = {
    [k('main')]: 'running',
    [k('whatsapp:dm:+51999888777')]: 'thinking',
    [k('whatsapp:dm:+51988777666')]: 'idle',
    [k('cron:6f1d2c3b')]: 'aborted',
  };

  // Options come from the gateway session list + ui status map; each story seeds them.
  const seed =
    (list: typeof gw.sessions, selected: string | null = k('main')) =>
    async () => {
      gw.sessions = list;
      ui.sessionStatus = status;
      ui.selectedSessionKey = selected;
    };
  const opened: PlayFunction = async (ctx) => {
    await seed(sessions)();
    await ctx.userEvent.click(ctx.canvas.getAllByRole('button')[0]);
  };

  const { Story } = defineMeta({
    title: 'Components/Sessions/SessionDropdown',
    component: SessionDropdown,
    tags: ['autodocs'],
    parameters: { docs: { story: { inline: false, height: '360px' } } },
    args: { agentId: AGENT, serverId: null },
  });
</script>

<Story name="Main session selected" play={seed(sessions)}>
  {#snippet template(args)}<div class="w-80"><SessionDropdown {...args} /></div>{/snippet}
</Story>

<Story name="Other session selected" play={seed(sessions, k('whatsapp:dm:+51999888777'))}>
  {#snippet template(args)}<div class="w-80"><SessionDropdown {...args} /></div>{/snippet}
</Story>

<Story name="Open" play={opened}>
  {#snippet template(args)}<div class="w-80"><SessionDropdown {...args} /></div>{/snippet}
</Story>

<Story name="No sessions" play={seed([], null)}>
  {#snippet template(args)}<div class="w-80"><SessionDropdown {...args} /></div>{/snippet}
</Story>
