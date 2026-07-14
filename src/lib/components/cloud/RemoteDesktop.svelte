<script lang="ts">
  import { createShellAccess, type ShellSummary } from '$lib/services/shells-rpc';
  import { Expand, ExternalLink, Loader2, Monitor, RefreshCw } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';

  let { shell }: { shell: ShellSummary } = $props();
  let frame = $state<HTMLIFrameElement>();
  let url = $state<string | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);
  let generation = 0;

  function safeDesktopUrl(raw: string): string {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' && !(import.meta.env.DEV && parsed.protocol === 'http:')) {
      throw new Error(m.cloud_access_invalid_url());
    }
    // Current gateways return the explicit noVNC URL. Keep older/provider
    // responses desktop-specific too instead of embedding their generic proxy
    // landing page.
    if (parsed.hostname.endsWith('.exe.xyz') && (parsed.pathname === '/' || parsed.pathname === '')) {
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
    return () => { generation += 1; };
  });
</script>

<div class="desktop-shell">
  <div class="desktop-bar">
    <div class="traffic"><span></span><span></span><span></span></div>
    <Monitor size={13} />
    <span>{shell.displayName}</span>
    <span class="session">{m.cloud_desktop_session_label()}</span>
    {#if url}
      <a href={url} target="_blank" rel="noreferrer" title={m.cloud_open_new_tab()} aria-label={m.cloud_open_new_tab()}>
        <ExternalLink size={13} />
      </a>
    {/if}
    <button type="button" onclick={() => void connect()} disabled={loading} title={m.cloud_retry()} aria-label={m.cloud_retry()}>
      {#if loading}<Loader2 size={13} class="animate-spin" />{:else}<RefreshCw size={13} />{/if}
    </button>
    <button type="button" onclick={fullscreen} disabled={!url} title={m.cloud_fullscreen()} aria-label={m.cloud_fullscreen()}><Expand size={13} /></button>
  </div>

  {#if loading}
    <div class="desktop-state"><Loader2 size={22} class="animate-spin" /><span>{m.cloud_desktop_starting()}</span></div>
  {:else if error}
    <div class="desktop-state error-state">
      <Monitor size={26} />
      <strong>{m.cloud_access_unavailable()}</strong>
      <span>{error}</span>
      <button type="button" onclick={() => void connect()}>{m.cloud_retry()}</button>
    </div>
  {:else if url}
    <iframe
      bind:this={frame}
      src={url}
      title={m.cloud_gui_frame_title({ name: shell.displayName })}
      allow="clipboard-read; clipboard-write; fullscreen; publickey-credentials-get *"
      referrerpolicy="no-referrer"
    ></iframe>
  {/if}
</div>

<style>
  .desktop-shell { height: 100%; min-height: 0; display: flex; flex-direction: column; background: #090b0f; }
  .desktop-bar { height: 2.35rem; padding: 0 .65rem; flex: 0 0 auto; display: flex; align-items: center; gap: .5rem; border-bottom: 1px solid rgba(255,255,255,.08); color: #a8b0bd; font: 500 .65rem/1 var(--font-mono, monospace); }
  .traffic { display: flex; gap: .3rem; margin-right: .2rem; }
  .traffic span { width: .48rem; height: .48rem; border-radius: 50%; background: #38404b; }
  .traffic span:first-child { background: #ef6a62; }
  .traffic span:nth-child(2) { background: #eab950; }
  .traffic span:nth-child(3) { background: #57bd70; }
  .session { margin-left: auto; color: #606a78; font-size: .55rem; letter-spacing: .09em; }
  .desktop-bar button, .desktop-bar a { width: 1.65rem; height: 1.65rem; display: grid; place-items: center; border: 0; border-radius: .3rem; background: transparent; color: #768192; cursor: pointer; }
  .desktop-bar button:hover:not(:disabled), .desktop-bar a:hover { color: #dce2ea; background: rgba(255,255,255,.06); }
  .desktop-bar button:disabled { opacity: .35; cursor: default; }
  iframe { flex: 1; min-height: 0; width: 100%; border: 0; background: #11141a; }
  .desktop-state { flex: 1; display: grid; place-items: center; align-content: center; gap: .7rem; color: #7c8798; font-size: .72rem; }
  .error-state { text-align: center; padding: 2rem; }
  .error-state > :global(svg) { color: #586373; }
  .error-state strong { color: #eef2f7; font-size: .82rem; }
  .error-state span { max-width: 34rem; font: .65rem/1.5 var(--font-mono, monospace); }
  .error-state button { height: 2rem; padding: 0 .75rem; border: 1px solid rgba(255,255,255,.12); border-radius: .35rem; background: rgba(255,255,255,.04); color: #ccd4df; cursor: pointer; font-size: .7rem; }
</style>
