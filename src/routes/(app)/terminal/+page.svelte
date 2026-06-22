<script lang="ts">
  import { onMount } from 'svelte';
  import { SquareTerminal } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { getActiveHost, fetchHostToken, loadHosts } from '$lib/state/features/hosts.svelte';

  // Fixed grid — must match the gateway PTY (wterm's WebSocketTransport carries
  // no resize frame). See minion/src/gateway/pty-ws.ts (PTY_COLS / PTY_ROWS).
  const COLS = 120;
  const ROWS = 34;

  let host = $state<HTMLDivElement>();
  let err = $state<string | null>(null);
  let status = $state('Connecting…');

  /** gateway host.url is already ws:// or wss:// → reuse origin, swap path. */
  function ptyUrl(hostUrl: string, token: string): string {
    const u = new URL(hostUrl);
    u.pathname = '/pty';
    u.search = `?token=${encodeURIComponent(token)}`;
    u.hash = '';
    return u.toString();
  }

  onMount(() => {
    let destroy: (() => void) | undefined;
    (async () => {
      try {
        // Seed activeHostId from page.data + localStorage — the layout's init
        // onMount races with this child onMount, so don't depend on it.
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

        const [{ WTerm, WebSocketTransport }] = await Promise.all([import('@wterm/dom')]);
        // @ts-expect-error CSS side-effect import has no type declaration
        await import('@wterm/dom/css');

        const term = new WTerm(host!, { cols: COLS, rows: ROWS, autoResize: false, cursorBlink: true });
        await term.init();

        const ws = new WebSocketTransport({
          url: ptyUrl(active.url, token),
          onData: (data: Uint8Array | string) => term.write(data),
          onOpen: () => (status = `Connected · ${active.name ?? active.url}`),
          onClose: () => (status = 'Disconnected'),
          onError: () => (status = 'Connection error'),
        });
        ws.connect();
        term.onData = (d: string) => ws.send(d);
        term.focus();

        destroy = () => {
          try {
            ws.close();
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

<div class="page">
  <header class="head">
    <SquareTerminal size={18} class="shrink-0 opacity-80" />
    <h1>{m.nav_terminal()}</h1>
    {#if !err}<span class="status">{status}</span>{/if}
  </header>
  {#if err}
    <p class="err">{err}</p>
  {/if}
  <div class="term" bind:this={host}></div>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    height: 100%;
    min-height: 0;
    padding: 1rem;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .head h1 {
    font-size: 0.95rem;
    font-weight: 600;
    margin: 0;
  }
  .status {
    margin-left: auto;
    font-size: 0.75rem;
    color: var(--color-muted);
  }
  .err {
    color: var(--color-danger, #f87171);
    font-size: 0.8125rem;
  }
  .term {
    flex: 1;
    min-height: 0;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    background: #0a0a0c;
    padding: 0.5rem;
    overflow: auto;
  }
</style>
