<script lang="ts">
  import { onDestroy } from "svelte";
  import { mountHostBridge, type MountedHostBridge } from "./bridge-host";
  import type { Theme } from "./bridge-protocol";

  interface Props {
    pluginId: string;
    gatewayUrl: string;
    authToken: string;
    theme: Theme;
    tokens: Record<string, string>;
  }

  let { pluginId, gatewayUrl, authToken, theme, tokens }: Props = $props();

  let iframeEl: HTMLIFrameElement | null = $state(null);
  let mounted: MountedHostBridge | null = null;
  let height = $state(600);

  const src = `${gatewayUrl}/plugins/${pluginId}/ui/`;
  const pluginOrigin = new URL(gatewayUrl).origin;

  function handleLoad(): void {
    if (!iframeEl?.contentWindow) return;
    mounted?.dispose();
    mounted = mountHostBridge({
      self: window,
      target: iframeEl.contentWindow,
      pluginOrigin,
      hello: { theme, tokens, gatewayUrl, authToken },
      onResize: (h) => {
        height = h;
      },
    });
  }

  $effect(() => {
    mounted?.sendThemeChange(theme, tokens);
  });

  onDestroy(() => mounted?.dispose());
</script>

<iframe
  bind:this={iframeEl}
  title="Plugin: {pluginId}"
  {src}
  onload={handleLoad}
  style:height="{height}px"
  class="w-full border-0"
></iframe>
