<script lang="ts">
  import { onMount } from 'svelte';
  import { SquareTerminal } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { getActiveHost, fetchHostToken, loadHosts } from '$lib/state/features/hosts.svelte';
  import { PageHeader } from '$lib/components/ui';
  import { AsyncBoundary, PageBody, PageShell } from '$lib/components/ui/foundations';

  // Fixed grid — must match the gateway PTY (no resize frame in raw WS mode).
  // See minion/src/gateway/pty-ws.ts (PTY_COLS / PTY_ROWS).
  const COLS = 120;
  const ROWS = 34;

  let host = $state<HTMLDivElement>();
  let err = $state<string | null>(null);
  let status = $state('Connecting…');

  /** gateway host.url is already ws:// or wss:// → reuse origin, swap path. */
  function ptyUrl(hostUrl: string): string {
    const u = new URL(hostUrl);
    u.pathname = '/pty';
    u.search = '';
    u.hash = '';
    return u.toString();
  }

  onMount(() => {
    let destroy: (() => void) | undefined;
    (async () => {
      try {
        loadHosts();
        const active = getActiveHost();
        if (!active?.url) {
          err = 'No gateway connected. Connect a host first.';
          return;
        }
        const token = await fetchHostToken(active.id);
        if (!token) {
          err = 'Could not obtain a gateway token (are you signed in?).';
          return;
        }

        const [{ WTerm }] = await Promise.all([import('@wterm/dom')]);
        // @ts-expect-error CSS side-effect import has no type declaration
        await import('@wterm/dom/css');

        const term = new WTerm(host!, {
          cols: COLS,
          rows: ROWS,
          autoResize: false,
          cursorBlink: true,
        });
        await term.init();

        // Pass token as WS subprotocol — stays in Sec-WebSocket-Protocol header,
        // not the URL, so it won't appear in proxy access logs.
        const socket = new WebSocket(ptyUrl(active.url), [token]);
        socket.binaryType = 'arraybuffer';

        socket.addEventListener('open', () => {
          status = `Connected · ${active.name ?? active.url}`;
          term.onData = (d: string) => {
            if (socket.readyState === WebSocket.OPEN) socket.send(d);
          };
          term.focus();
        });
        socket.addEventListener('message', (e: MessageEvent) => {
          term.write(e.data instanceof ArrayBuffer ? new Uint8Array(e.data) : (e.data as string));
        });
        socket.addEventListener('close', () => (status = 'Disconnected'));
        socket.addEventListener('error', () => (status = 'Connection error'));

        destroy = () => {
          try {
            socket.close();
          } catch {
            /* ignore */
          }
          term.destroy();
        };
      } catch (e) {
        err = e instanceof Error ? e.message : String(e);
      }
    })();
    return () => destroy?.();
  });
</script>

<svelte:head><title>Terminal · Minion hub</title></svelte:head>

<PageShell archetype="terminal" scroll="none" variant="terminal" labelledBy="terminal-page-title">
  <PageHeader
    title={m.nav_terminal()}
    subtitle={!err ? status : undefined}
    titleId="terminal-page-title"
    sticky={false}
  >
    {#snippet leading()}<SquareTerminal size={18} class="shrink-0 opacity-80" />{/snippet}
  </PageHeader>
  <PageBody padding="compact" scroll="none" class="terminal-body">
    {#if err}
      <AsyncBoundary state={{ kind: 'unavailable', title: err }} />
    {:else}
      <div class="term" bind:this={host} aria-label={m.nav_terminal()}></div>
    {/if}
  </PageBody>
</PageShell>

<style>
  :global(.terminal-body) {
    display: flex;
    flex-direction: column;
  }
  .term {
    flex: 1;
    min-height: 0;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    background: var(--color-canvas, var(--color-bg));
    padding: var(--space-2, 0.5rem);
    overflow: auto;
  }
</style>
