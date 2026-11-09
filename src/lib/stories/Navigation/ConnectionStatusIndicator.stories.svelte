<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import ConnectionStatusIndicator from '$lib/components/layout/ConnectionStatusIndicator.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { gw } from '$lib/state/gateway/gateway-data.svelte';
  import { hostsState } from '$lib/state/features/hosts.svelte';
  import { restartState } from '$lib/state/config/restart.svelte';

  // Status comes from global connection state; each story seeds it in `play`.
  // Non-admin page data so the fleet-update poll never fires.
  const host = {
    id: 'gw-1',
    name: 'netcup-prd',
    url: 'wss://gw.example.com',
    lastConnectedAt: Date.now() - 5 * 60000,
    channel: 'prd',
  };
  const seed = (state) => async () => {
    hostsState.activeHostId = 'gw-1';
    conn.connected = false;
    conn.connecting = false;
    conn.connectedAt = null;
    conn.connectError = null;
    restartState.phase = 'idle';
    gw.hello = null;
    Object.assign(conn, state.conn ?? {});
    if (state.hello) gw.hello = state.hello;
    if (state.restart) restartState.phase = state.restart;
  };

  const { Story } = defineMeta({
    title: 'Navigation/ConnectionStatusIndicator',
    component: ConnectionStatusIndicator,
    tags: ['autodocs'],
    parameters: {
      docs: { story: { inline: false, height: '220px' } },
      sveltekit_experimental: {
        state: {
          page: { data: { user: { id: 'u-1', role: 'user' }, hosts: { servers: [host] } } },
        },
      },
    },
    argTypes: {
      panel: { control: 'select', options: ['below', 'above'] },
      popoverEnabled: { control: 'boolean' },
    },
    args: { open: true, panel: 'below', popoverEnabled: true },
  });
</script>

<Story
  name="Connected"
  play={seed({
    conn: { connected: true, connectedAt: Date.now() - 3600000 },
    hello: { snapshot: { uptimeMs: 86400000 * 3 }, server: { version: '2026.11.1' } },
  })}
>
  {#snippet template(args)}
    <div class="p-4 pl-6"><ConnectionStatusIndicator {...args} /></div>
  {/snippet}
</Story>

<Story name="Reconnecting" play={seed({ conn: { connecting: true } })}>
  {#snippet template(args)}
    <div class="p-4 pl-6"><ConnectionStatusIndicator {...args} /></div>
  {/snippet}
</Story>

<Story name="Restarting (expected)" play={seed({ restart: 'restarting' })}>
  {#snippet template(args)}
    <div class="p-4 pl-6"><ConnectionStatusIndicator {...args} /></div>
  {/snippet}
</Story>

<Story
  name="Disconnected (error)"
  play={seed({
    conn: {
      connectError: 'Gateway unreachable',
      connectErrorHint: 'Check the server is running and the token is valid.',
    },
  })}
>
  {#snippet template(args)}
    <div class="p-4 pl-6"><ConnectionStatusIndicator {...args} /></div>
  {/snippet}
</Story>

<Story
  name="Panel above (sidebar footer)"
  args={{ panel: 'above' }}
  play={seed({
    conn: { connected: true, connectedAt: Date.now() - 120000 },
    hello: { snapshot: { uptimeMs: 3600000 } },
  })}
>
  {#snippet template(args)}
    <div class="p-4 pt-48 pl-6"><ConnectionStatusIndicator {...args} /></div>
  {/snippet}
</Story>

<Story
  name="Dot only (closed)"
  args={{ open: false }}
  play={seed({ conn: { connected: true, connectedAt: Date.now() } })}
>
  {#snippet template(args)}
    <div class="p-4 pl-6"><ConnectionStatusIndicator {...args} /></div>
  {/snippet}
</Story>
