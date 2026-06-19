<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { mountHostBridge, type MountedHostBridge } from '$lib/plugins/bridge-host';
  import { artifactSrc, type ArtifactDescriptor } from '$lib/agents/artifacts';

  // `chrome` = render the framed card + title header around the iframe (the detail
  // page). In a DraggableDialog window the dialog already supplies frame + header,
  // so the host renders bare (just the iframe) to avoid a duplicate header / shell.
  let { descriptor, chrome = true }: { descriptor: ArtifactDescriptor; chrome?: boolean } = $props();

  let iframeEl = $state<HTMLIFrameElement | null>(null);
  let mounted: MountedHostBridge | null = null;
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
      try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule && rule.selectorText === ':root') {
          for (let i = 0; i < rule.style.length; i++) {
            const k = rule.style[i];
            if (k.startsWith('--') && !(k in tokens)) tokens[k] = rule.style.getPropertyValue(k);
          }
        }
      }
    }
    return { theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light', tokens };
  }

  // Artifact data: answer hub.artifact.context.get from the hub API; reject anything else.
  async function forwardRpc(method: string): Promise<unknown> {
    if (method !== 'hub.artifact.context.get') throw new Error(`artifact rpc not allowed: ${method}`);
    const res = await fetch(
      `/api/artifacts/${descriptor.id}/context?agentId=${encodeURIComponent(descriptor.agentId)}`,
      { credentials: 'same-origin' },
    );
    if (!res.ok) throw new Error(`context ${res.status}`);
    return res.json();
  }

  onMount(() => {
    if (!iframeEl?.contentWindow) return;
    const { theme, tokens } = snapshot();
    mounted = mountHostBridge({
      self: window,
      target: iframeEl.contentWindow,
      pluginOrigin: origin,
      hello: { theme, tokens, gatewayUrl: '', authToken: '' },
      forwardRpc: (method, _params) => forwardRpc(method),
    });
  });

  onDestroy(() => mounted?.dispose());
</script>

{#if chrome}
  <div class="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
    <div class="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-xs font-medium text-white/70">
      {descriptor.title}
    </div>
    {#if src}
      <iframe
        bind:this={iframeEl}
        {src}
        title={descriptor.title}
        referrerpolicy="strict-origin"
        class="min-h-0 w-full flex-1 border-0"
      ></iframe>
    {/if}
  </div>
{:else if src}
  <!-- bare: the dialog provides the frame + header -->
  <iframe
    bind:this={iframeEl}
    {src}
    title={descriptor.title}
    referrerpolicy="strict-origin"
    class="h-full w-full border-0"
  ></iframe>
{/if}
