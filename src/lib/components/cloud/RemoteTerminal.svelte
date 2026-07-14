<script lang="ts">
  import { createShellAccess, type ShellSummary } from '$lib/services/shells-rpc';
  import { ExternalLink, RefreshCw, SquareTerminal } from 'lucide-svelte';
  import { Button } from '$lib/components/ui';
  import { AsyncBoundary, type AsyncBoundaryState } from '$lib/components/ui/foundations';
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

  const accessState = $derived.by<AsyncBoundaryState>(() => {
    if (connecting || (!transport && !error)) {
      return { kind: 'loading', label: m.cloud_access_connecting() };
    }
    if (error) {
      return {
        kind: 'error',
        title: m.cloud_access_unavailable(),
        description: error,
        retry: () => void connect(),
      };
    }
    return { kind: 'ready' };
  });

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
        term.write(
          event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : (event.data as string),
        );
      });
      socket.addEventListener('close', () => (status = m.cloud_access_disconnected()));
      socket.addEventListener('error', () => (status = m.cloud_access_error()));
      cleanup = () => {
        try {
          socket.close();
        } catch {
          // The socket is already closed.
        }
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
    <SquareTerminal size={14} aria-hidden="true" />
    <span class="status" aria-live="polite">{status}</span>
    <span class="protocol">{m.cloud_terminal_session_label()}</span>
    {#if accessUrl && transport === 'iframe'}
      <Button
        href={accessUrl}
        variant="ghost"
        size="icon"
        target="_blank"
        rel="noreferrer"
        title={m.cloud_open_new_tab()}
        aria-label={m.cloud_open_new_tab()}
      >
        <ExternalLink size={13} aria-hidden="true" />
      </Button>
    {/if}
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onclick={() => void connect()}
      loading={connecting}
      aria-label={m.cloud_retry()}
      title={m.cloud_retry()}
    >
      <RefreshCw size={13} aria-hidden="true" />
    </Button>
  </div>

  <div class="terminal-stage">
    {#if accessUrl && transport === 'iframe' && !error}
      <iframe src={accessUrl} title={m.cloud_terminal_frame_title({ name: shell.displayName })}
      ></iframe>
    {/if}
    <div
      class="terminal"
      class:hidden={!!error || transport !== 'websocket'}
      bind:this={host}
    ></div>
    {#if accessState.kind !== 'ready'}
      <div class="terminal-state">
        <AsyncBoundary state={accessState} compact />
      </div>
    {/if}
  </div>
</div>

<style>
  .terminal-shell,
  .terminal-stage {
    display: flex;
    width: 100%;
    min-width: 0;
    min-height: 0;
    flex: 1;
    flex-direction: column;
  }

  .terminal-shell {
    background: var(--color-canvas);
  }

  .terminal-bar {
    display: flex;
    min-height: var(--control-height-lg);
    flex: none;
    align-items: center;
    gap: var(--space-2);
    padding-inline: var(--space-3);
    border-bottom: 1px solid var(--color-border-subtle);
    color: var(--color-text-secondary);
    background: var(--color-surface-1);
    font-family: var(--font-mono);
    font-size: var(--font-size-telemetry);
    line-height: var(--line-height-compact);
    letter-spacing: var(--letter-spacing-label);
  }

  .terminal-bar > :global(svg) {
    flex: none;
    color: var(--color-accent);
  }

  .status {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .protocol {
    margin-left: auto;
    color: var(--color-text-tertiary);
    text-transform: uppercase;
  }

  .terminal-stage {
    position: relative;
  }

  .terminal,
  iframe {
    width: 100%;
    min-height: 0;
    flex: 1;
    border: 0;
    background: var(--color-canvas);
  }

  .terminal {
    padding: var(--space-2);
    overflow: hidden;
  }

  .hidden {
    display: none;
  }

  .terminal-state {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: var(--color-canvas);
  }

  @media (max-width: 599.98px) {
    .protocol {
      display: none;
    }

    .status {
      margin-right: auto;
    }
  }
</style>
