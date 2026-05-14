<script lang="ts">
  import { onDestroy } from "svelte";
  import { mountHostBridge, type MountedHostBridge } from "./bridge-host";
  import type { Theme } from "./bridge-protocol";

  interface Props {
    pluginId: string;
    entrypoint: string;
    gatewayUrl: string;
    authToken: string;
    theme: Theme;
    tokens: Record<string, string>;
  }

  let { pluginId, entrypoint, gatewayUrl, authToken, theme, tokens }: Props = $props();

  let iframeEl: HTMLIFrameElement | null = $state(null);
  // Plain `let` (not $state) — the bridge-mount $effect both reads
  // `mounted?.dispose()` and writes `mounted = ...`. Making this reactive
  // creates an infinite re-run loop ("updated at PluginIframe.svelte" warning
  // in console) and the iframe never settles.
  let mounted: MountedHostBridge | null = null;
  let height = $state(600);

  // Gateway serves /plugins/<id>/ui/<subpath> resolving against ui/dist/.
  // Some manifests list entrypoint as "ui/dist/index.html" (disk path); strip
  // that prefix so the URL is just /plugins/<id>/ui/index.html.
  const subpath = entrypoint.replace(/^ui\/dist\//, "").replace(/^\/+/, "");
  // Pass the host origin via URL hash so the plugin can validate inbound
  // postMessage events without depending on document.referrer (which is
  // stripped under strict Referrer-Policy for cross-origin iframes — that
  // failure mode silently bricks the plugin's bridge handshake).
  const hostOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const srcBase = `${gatewayUrl}/plugins/${pluginId}/ui/${subpath}`;
  const src = hostOrigin
    ? `${srcBase}#hostOrigin=${encodeURIComponent(hostOrigin)}`
    : srcBase;
  const pluginOrigin = new URL(gatewayUrl).origin;

  // Mount the host bridge as soon as iframeEl is bound — NOT in the iframe's
  // onload handler. The plugin's `notifyReady()` fires synchronously when its
  // module loads; if we wait for `onload` to register the listener, that
  // message has already dispatched and is lost, leaving the plugin stuck on
  // its loading screen forever. Binding-time mount + the buffered hello in
  // HostBridge.flushHello cover both ordering races.
  $effect(() => {
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
  });

  $effect(() => {
    mounted?.sendThemeChange(theme, tokens);
  });

  onDestroy(() => mounted?.dispose());
</script>

<iframe
  bind:this={iframeEl}
  title="Plugin: {pluginId}"
  {src}
  referrerpolicy="strict-origin"
  style:height="{height}px"
  class="w-full border-0"
></iframe>
