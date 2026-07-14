<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { mountHostBridge, type MountedHostBridge } from '$lib/plugins/bridge-host';
  import { artifactSrc, type ArtifactDescriptor } from '$lib/agents/artifacts';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import * as m from '$lib/paraglide/messages';

  // `chrome` = render the framed card + title header around the iframe (the detail
  // page). In a DraggableDialog window the dialog already supplies frame + header,
  // so the host renders bare (just the iframe) to avoid a duplicate header / shell.
  let { descriptor, chrome = true }: { descriptor: ArtifactDescriptor; chrome?: boolean } =
    $props();

  let iframeEl = $state<HTMLIFrameElement | null>(null);
  let mounted: MountedHostBridge | null = null;
  // Show a styled loading overlay until the bundle completes the bridge handshake
  // (plugin:ready). A timeout reveals the iframe anyway so a misbehaving bundle
  // never leaves an infinite spinner.
  let ready = $state(false);
  let revealTimer: ReturnType<typeof setTimeout> | undefined;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const src = $derived(origin ? artifactSrc(descriptor, origin) : '');

  // Snapshot the hub's CSS custom properties + theme so the artifact themes to match.
  function snapshot(): { theme: 'light' | 'dark'; tokens: Record<string, string> } {
    const tokens: Record<string, string> = {};
    const rootStyle = document.documentElement.style;
    for (let i = 0; i < rootStyle.length; i++) {
      const k = rootStyle[i];
      if (k.startsWith('--')) tokens[k] = rootStyle.getPropertyValue(k);
    }
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule && rule.selectorText === ':root') {
          for (let i = 0; i < rule.style.length; i++) {
            const k = rule.style[i];
            if (k.startsWith('--') && !(k in tokens)) tokens[k] = rule.style.getPropertyValue(k);
          }
        }
      }
    }
    return {
      theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
      tokens,
    };
  }

  // Artifact data: answer hub.artifact.context.get from the hub API; reject anything else.
  async function forwardRpc(method: string): Promise<unknown> {
    if (method !== 'hub.artifact.context.get')
      throw new Error(`artifact rpc not allowed: ${method}`);
    const res = await fetch(
      `/api/artifacts/${descriptor.id}/context?agentId=${encodeURIComponent(descriptor.agentId)}`,
      { credentials: 'same-origin' },
    );
    if (!res.ok) throw new Error(`context ${res.status}`);
    const data = await res.json();
    // Context is on its way to the bundle, which renders on receipt. Hide the
    // overlay a beat later so we never flash the bundle's own loading state.
    // (Not on plugin:ready — that fires before the bundle has data to render.)
    clearTimeout(revealTimer);
    revealTimer = setTimeout(() => (ready = true), 250);
    return data;
  }

  onMount(() => {
    if (!iframeEl?.contentWindow) return;
    const { theme, tokens } = snapshot();
    mounted = mountHostBridge({
      self: window,
      target: iframeEl.contentWindow,
      pluginOrigin: origin,
      // Artifacts run in a sandbox="allow-scripts" iframe (opaque origin): they
      // post with origin "null" and are reached via "*". Validate by source window.
      sandboxed: true,
      hello: { theme, tokens, gatewayUrl: '', authToken: '' },
      forwardRpc: (method, _params) => forwardRpc(method),
    });
    // Fallback: reveal anyway if the bundle never requests context (12s).
    revealTimer = setTimeout(() => (ready = true), 12000);
  });

  onDestroy(() => {
    clearTimeout(revealTimer);
    mounted?.dispose();
  });
</script>

{#snippet loadingOverlay()}
  {#if !ready}
    <div class="absolute inset-0 grid place-items-center bg-bg2/90 backdrop-blur-sm">
      <div class="flex flex-col items-center gap-2.5">
        <Spinner size="lg" />
        <span class="text-xs font-medium tracking-wide text-muted-foreground"
          >{m.artifact_loading()}</span
        >
      </div>
    </div>
  {/if}
{/snippet}

{#if chrome}
  <div
    class="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-foreground/[0.02]"
  >
    <div
      class="flex items-center gap-2 border-b border-border px-3 py-2 text-xs font-medium text-muted"
    >
      {descriptor.title}
    </div>
    <div class="relative min-h-0 w-full flex-1">
      {#if src}
        <iframe
          bind:this={iframeEl}
          {src}
          title={descriptor.title}
          referrerpolicy="strict-origin"
          sandbox="allow-scripts"
          class="h-full w-full border-0"
        ></iframe>
      {/if}
      {@render loadingOverlay()}
    </div>
  </div>
{:else if src}
  <!-- bare: the dialog provides the frame + header -->
  <div class="relative h-full w-full">
    <iframe
      bind:this={iframeEl}
      {src}
      title={descriptor.title}
      referrerpolicy="strict-origin"
      sandbox="allow-scripts"
      class="h-full w-full border-0"
    ></iframe>
    {@render loadingOverlay()}
  </div>
{/if}
