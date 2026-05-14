<script lang="ts">
  import { onDestroy } from "svelte";
  import { mountHostBridge, type MountedHostBridge } from "./bridge-host";
  import type { Theme } from "./bridge-protocol";

  // Lazy import to keep this component test-renderable without pulling
  // SvelteKit-only modules (gateway service transitively imports $app/state).
  async function forwardRpc(method: string, params: unknown): Promise<unknown> {
    const mod = await import("$lib/services/gateway.svelte");
    return mod.sendRequest(method, params);
  }

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

  // Handshake observability: track which stages of the iframe→bridge handshake
  // have happened. If `plugin:ready` doesn't arrive within HANDSHAKE_TIMEOUT_MS
  // we render a diagnostic overlay instead of leaving the user staring at the
  // plugin's "Loading…" screen with no actionable info.
  const HANDSHAKE_TIMEOUT_MS = 2500;
  let iframeLoaded = $state(false);
  let pluginReady = $state(false);
  let handshakeTimedOut = $state(false);
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

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
  // hello.gatewayUrl is consumed by the plugin's WebSocket client. The hub
  // surfaces gatewayUrl as HTTP(S) because it's also used to derive the
  // pluginOrigin for postMessage targeting; the plugin needs the ws(s):
  // equivalent. Convert here so plugins don't have to think about it.
  const wsGatewayUrl = gatewayUrl.replace(/^http/, "ws");

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
      hello: { theme, tokens, gatewayUrl: wsGatewayUrl, authToken },
      onResize: (h) => {
        height = h;
      },
      onPluginReady: () => {
        pluginReady = true;
        if (timeoutHandle !== null) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
      },
      // Plugin RPC forwarded through the hub's existing privileged gateway WS.
      // Plugins call `bridge.call("plugins.config.get", { ... })` from inside
      // their iframe; this function relays through sendRequest, so they never
      // see the gateway token, never need to reimplement the connect frame
      // protocol, and don't open a second WebSocket.
      forwardRpc,
    });
    if (timeoutHandle === null && !pluginReady) {
      timeoutHandle = setTimeout(() => {
        if (!pluginReady) {
          console.warn("[PluginIframe] handshake timed out", {
            pluginId,
            src,
            pluginOrigin,
            hostOrigin,
            iframeLoaded,
            pluginReady,
          });
          handshakeTimedOut = true;
        }
      }, HANDSHAKE_TIMEOUT_MS);
    }
  });

  $effect(() => {
    mounted?.sendThemeChange(theme, tokens);
  });

  onDestroy(() => {
    mounted?.dispose();
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  });
</script>

<div class="relative w-full">
  <iframe
    bind:this={iframeEl}
    title="Plugin: {pluginId}"
    {src}
    referrerpolicy="strict-origin"
    onload={() => {
      iframeLoaded = true;
    }}
    style:height="{height}px"
    class="w-full border-0"
  ></iframe>
  {#if handshakeTimedOut && !pluginReady}
    <div
      class="bg-background/95 absolute inset-0 z-10 flex items-start justify-center overflow-auto p-6 backdrop-blur"
    >
      <div class="max-w-xl space-y-3 rounded-md border border-destructive/50 bg-card p-4 text-sm">
        <header class="font-semibold text-destructive">
          Plugin handshake timed out ({HANDSHAKE_TIMEOUT_MS / 1000}s)
        </header>
        <p class="text-muted-foreground">
          The plugin loaded its assets but did not send <code>plugin:ready</code> in time, or its
          <code>host:hello</code> reply was rejected. Common causes: cross-origin Referrer-Policy
          stripped the host origin, the plugin throws before <code>bridge.notifyReady()</code>, or
          the plugin's gateway WebSocket fails immediately.
        </p>
        <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs">
          <dt class="text-muted-foreground">plugin</dt>
          <dd>{pluginId}</dd>
          <dt class="text-muted-foreground">iframe src</dt>
          <dd class="break-all">{src}</dd>
          <dt class="text-muted-foreground">plugin origin</dt>
          <dd>{pluginOrigin}</dd>
          <dt class="text-muted-foreground">host origin</dt>
          <dd>{hostOrigin || "(unknown — SSR?)"}</dd>
          <dt class="text-muted-foreground">iframe loaded</dt>
          <dd>{iframeLoaded ? "yes" : "no"}</dd>
          <dt class="text-muted-foreground">plugin:ready</dt>
          <dd>{pluginReady ? "yes" : "no"}</dd>
        </dl>
        <p class="text-muted-foreground">
          Open the iframe URL directly in a new tab and check its console for errors. If the page
          shows the plugin's own "Loading…" screen, the bridge handshake is the culprit — check
          DevTools → Network for postMessage failures.
        </p>
      </div>
    </div>
  {/if}
</div>
