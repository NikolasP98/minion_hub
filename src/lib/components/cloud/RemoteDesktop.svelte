<script lang="ts">
  import { createShellAccess, type ShellSummary } from '$lib/services/shells-rpc';
  import { Expand, ExternalLink, Monitor, RefreshCw } from 'lucide-svelte';
  import { Button } from '$lib/components/ui';
  import { AsyncBoundary, type AsyncBoundaryState } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';

  let { shell }: { shell: ShellSummary } = $props();
  let frame = $state<HTMLIFrameElement>();
  let url = $state<string | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);
  let generation = 0;

  const accessState = $derived.by<AsyncBoundaryState>(() => {
    if (loading || (!url && !error)) {
      return { kind: 'loading', label: m.cloud_desktop_starting() };
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

  function safeDesktopUrl(raw: string): string {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' && !(import.meta.env.DEV && parsed.protocol === 'http:')) {
      throw new Error(m.cloud_access_invalid_url());
    }
    if (
      parsed.hostname.endsWith('.exe.xyz') &&
      (parsed.pathname === '/' || parsed.pathname === '')
    ) {
      parsed.pathname = '/vnc.html';
      parsed.searchParams.set('autoconnect', '1');
      parsed.searchParams.set('resize', 'remote');
    }
    return parsed.toString();
  }

  async function connect(): Promise<void> {
    const current = ++generation;
    loading = true;
    error = null;
    url = null;
    try {
      const access = await createShellAccess(shell.shellId, 'desktop');
      if (current !== generation) return;
      url = safeDesktopUrl(access.url);
    } catch (err) {
      if (current !== generation) return;
      error = err instanceof Error ? err.message : String(err);
    } finally {
      if (current === generation) loading = false;
    }
  }

  function fullscreen(): void {
    void frame?.requestFullscreen?.();
  }

  $effect(() => {
    shell.shellId;
    void connect();
    return () => {
      generation += 1;
    };
  });
</script>

<div class="desktop-shell">
  <div class="desktop-bar">
    <div class="traffic" aria-hidden="true"><span></span><span></span><span></span></div>
    <Monitor size={13} aria-hidden="true" />
    <strong>{shell.displayName}</strong>
    <span class="session">{m.cloud_desktop_session_label()}</span>
    {#if url}
      <Button
        href={url}
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
      {loading}
      title={m.cloud_retry()}
      aria-label={m.cloud_retry()}
    >
      <RefreshCw size={13} aria-hidden="true" />
    </Button>
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onclick={fullscreen}
      disabled={!url}
      title={m.cloud_fullscreen()}
      aria-label={m.cloud_fullscreen()}
    >
      <Expand size={13} aria-hidden="true" />
    </Button>
  </div>

  <AsyncBoundary state={accessState} class="desktop-boundary">
    {#if url}
      <iframe
        bind:this={frame}
        src={url}
        title={m.cloud_gui_frame_title({ name: shell.displayName })}
        allow="clipboard-read; clipboard-write; fullscreen; publickey-credentials-get *"
        referrerpolicy="no-referrer"
      ></iframe>
    {/if}
  </AsyncBoundary>
</div>

<style>
  .desktop-shell {
    display: flex;
    width: 100%;
    min-width: 0;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    background: var(--color-canvas);
  }

  .desktop-bar {
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
  }

  .desktop-bar strong {
    overflow: hidden;
    font-weight: var(--font-weight-medium);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .traffic {
    display: flex;
    flex: none;
    gap: var(--space-1);
  }

  .traffic span {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    background: var(--color-text-disabled);
  }

  .traffic span:first-child {
    background: var(--color-danger-fg);
  }

  .traffic span:nth-child(2) {
    background: var(--color-warning-fg, var(--color-warning));
  }

  .traffic span:nth-child(3) {
    background: var(--color-success-fg);
  }

  .session {
    margin-left: auto;
    color: var(--color-text-tertiary);
    letter-spacing: var(--letter-spacing-label);
    text-transform: uppercase;
  }

  :global(.desktop-boundary) {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex: 1;
  }

  iframe {
    width: 100%;
    min-height: 0;
    flex: 1;
    border: 0;
    background: var(--color-surface-1);
  }

  @media (max-width: 599.98px) {
    .traffic,
    .session {
      display: none;
    }

    .desktop-bar strong {
      margin-right: auto;
    }
  }
</style>
