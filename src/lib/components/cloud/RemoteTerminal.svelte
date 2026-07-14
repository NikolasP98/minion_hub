<script lang="ts">
  import { createShellAccess, type ShellSummary } from '$lib/services/shells-rpc';
  import { ExternalLink, Loader2, RefreshCw, SquareTerminal } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';

  let { shell }: { shell: ShellSummary } = $props();

  let host = $state<HTMLDivElement>();
  let connecting = $state(false);
  let status = $state(m.cloud_access_connecting());
  let error = $state<string | null>(null);
  let accessUrl = $state<string | null>(null);
  let transport = $state<'websocket' | 'iframe' | null>(null);
  let cleanup: (() => void) | null = null;
  let generation = 0;

  function safeAccessUrl(raw: string): { url: string; transport: 'websocket' | 'iframe' } {
    const url = new URL(raw);
    if (url.protocol === 'ws:' || url.protocol === 'wss:') {
      return { url: url.toString(), transport: 'websocket' };
    }
    if (url.protocol === 'https:' || (import.meta.env.DEV && url.protocol === 'http:')) {
      return { url: url.toString(), transport: 'iframe' };
    }
    throw new Error(m.cloud_access_invalid_url());
  }

  async function connect(): Promise<void> {
    const current = ++generation;
    cleanup?.();
    cleanup = null;
    connecting = true;
    error = null;
    accessUrl = null;
    transport = null;
    status = m.cloud_access_connecting();
    try {
      const access = await createShellAccess(shell.shellId, 'terminal');
      if (current !== generation) return;
      const target = safeAccessUrl(access.url);
      accessUrl = target.url;
      transport = target.transport;
      if (target.transport === 'iframe') {
        status = m.cloud_access_connected({ name: shell.displayName });
        return;
      }
      const [{ WTerm }] = await Promise.all([import('@wterm/dom')]);
      // @ts-expect-error CSS side-effect import has no type declaration
      await import('@wterm/dom/css');
      if (!host) throw new Error(m.cloud_terminal_mount_error());
      host.innerHTML = '';
      const term = new WTerm(host, { cols: 120, rows: 34, autoResize: true, cursorBlink: true });
      await term.init();
      const protocols = access.token ? [access.token] : undefined;
      const socket = new WebSocket(target.url, protocols);
      socket.binaryType = 'arraybuffer';
      socket.addEventListener('open', () => {
        status = m.cloud_access_connected({ name: shell.displayName });
        term.onData = (data: string) => {
          if (socket.readyState === WebSocket.OPEN) socket.send(data);
        };
        term.focus();
      });
      socket.addEventListener('message', (event: MessageEvent) => {
        term.write(event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : (event.data as string));
      });
      socket.addEventListener('close', () => (status = m.cloud_access_disconnected()));
      socket.addEventListener('error', () => (status = m.cloud_access_error()));
      cleanup = () => {
        try { socket.close(); } catch { /* already closed */ }
        term.destroy();
      };
    } catch (err) {
      if (current !== generation) return;
      error = err instanceof Error ? err.message : String(err);
      status = m.cloud_access_unavailable();
    } finally {
      if (current === generation) connecting = false;
    }
  }

  $effect(() => {
    shell.shellId;
    void connect();
    return () => {
      generation += 1;
      cleanup?.();
      cleanup = null;
    };
  });
</script>

<div class="terminal-shell">
  <div class="terminal-bar">
    <SquareTerminal size={14} />
    <span>{status}</span>
    <span class="protocol">{m.cloud_terminal_session_label()}</span>
    {#if accessUrl && transport === 'iframe'}
      <a href={accessUrl} target="_blank" rel="noreferrer" title={m.cloud_open_new_tab()} aria-label={m.cloud_open_new_tab()}>
        <ExternalLink size={13} />
      </a>
    {/if}
    <button type="button" onclick={() => void connect()} disabled={connecting} aria-label={m.cloud_retry()} title={m.cloud_retry()}>
      {#if connecting}<Loader2 size={13} class="animate-spin" />{:else}<RefreshCw size={13} />{/if}
    </button>
  </div>
  {#if error}
    <div class="access-error">
      <strong>{m.cloud_access_unavailable()}</strong>
      <span>{error}</span>
      <button type="button" onclick={() => void connect()}>{m.cloud_retry()}</button>
    </div>
  {/if}
  {#if accessUrl && transport === 'iframe' && !error}
    <iframe src={accessUrl} title={m.cloud_terminal_frame_title({ name: shell.displayName })}></iframe>
  {/if}
  <div class="terminal" class:hidden={!!error || transport !== 'websocket'} bind:this={host}></div>
</div>

<style>
  .terminal-shell { height: 100%; min-height: 0; display: flex; flex-direction: column; background: #080a0d; }
  .terminal-bar { height: 2.35rem; flex: 0 0 auto; padding: 0 .7rem; display: flex; align-items: center; gap: .5rem; border-bottom: 1px solid rgba(255,255,255,.08); color: #a8b0bd; font: 500 .65rem/1 var(--font-mono, monospace); letter-spacing: .02em; }
  .terminal-bar > :global(svg) { color: var(--color-accent); }
  .protocol { margin-left: auto; color: #606a78; font-size: .55rem; letter-spacing: .1em; }
  .terminal-bar button, .terminal-bar a { width: 1.7rem; height: 1.7rem; display: grid; place-items: center; border: 0; border-radius: .3rem; background: transparent; color: #768192; cursor: pointer; }
  .terminal-bar button:hover, .terminal-bar a:hover { background: rgba(255,255,255,.06); color: #dce2ea; }
  .terminal { flex: 1; min-height: 0; padding: .55rem; overflow: hidden; }
  iframe { flex: 1; min-height: 0; width: 100%; border: 0; background: #080a0d; }
  .hidden { display: none; }
  .access-error { flex: 1; display: grid; place-items: center; align-content: center; gap: .55rem; padding: 2rem; text-align: center; }
  .access-error strong { color: #f1f5f9; font-size: .82rem; }
  .access-error span { max-width: 34rem; color: #7c8798; font: .65rem/1.5 var(--font-mono, monospace); }
  .access-error button { margin-top: .3rem; height: 2rem; padding: 0 .75rem; border: 1px solid rgba(255,255,255,.12); border-radius: .35rem; background: rgba(255,255,255,.04); color: #ccd4df; cursor: pointer; font-size: .7rem; }
</style>
