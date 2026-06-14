<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { onDestroy } from "svelte";
  import { Loader2, Check, AlertTriangle, RotateCw } from "lucide-svelte";
  import { mountHostBridge, type MountedHostBridge } from "./bridge-host";
  import type { Theme } from "./bridge-protocol";

  // Lazy import to keep this component test-renderable without pulling
  // SvelteKit-only modules (gateway service transitively imports $app/state).
  async function forwardRpc(method: string, params: unknown): Promise<unknown> {
    // Hub-served RPCs: methods whose data lives in the hub DB (users,
    // identities, workspace state) are answered locally instead of forwarded
    // to the gateway, which has no concept of hub-side users/@aliases.
    if (method === "plugins.users.list") {
      const [usersRes, idsRes] = await Promise.all([
        fetch("/api/users", { credentials: "same-origin" }),
        fetch("/api/gateway/channel-identities", { credentials: "same-origin" }),
      ]);
      if (!usersRes.ok) throw new Error(`plugins.users.list: /api/users ${usersRes.status}`);
      if (!idsRes.ok)
        throw new Error(`plugins.users.list: /api/gateway/channel-identities ${idsRes.status}`);
      const { users } = (await usersRes.json()) as {
        users: Array<{ id: string; email: string; displayName: string | null; alias: string | null }>;
      };
      const { identities } = (await idsRes.json()) as {
        identities: Array<{
          userId: string;
          channel: string;
          channelUserId: string;
          displayName: string | null;
        }>;
      };
      const byUser = new Map<string, typeof identities>();
      for (const id of identities) {
        const arr = byUser.get(id.userId) ?? [];
        arr.push(id);
        byUser.set(id.userId, arr);
      }
      return {
        users: users.map((u) => ({
          id: u.id,
          name: u.displayName ?? u.email,
          alias: u.alias,
          identities: (byUser.get(u.id) ?? []).map((i) => ({
            channel: i.channel,
            identifier: i.channelUserId,
            displayName: i.displayName,
          })),
        })),
      };
    }
    const mod = await import("$lib/services/gateway.svelte");
    // Generation-class RPCs (e.g. studio.generate / studio.edit → an image
    // model) legitimately run far longer than the 15s default; give them a
    // generous ceiling so the hub doesn't time out a request the gateway is
    // still happily serving.
    const timeoutMs = /\.(generate|edit)$/.test(method) ? 180_000 : undefined;
    return mod.sendRequest(method, params, timeoutMs);
  }

  interface Props {
    pluginId: string;
    entrypoint: string;
    gatewayUrl: string;
    authToken: string;
    theme: Theme;
    tokens: Record<string, string>;
    /**
     * When true, the iframe suppresses its own sticky save bar and exposes the
     * save state via bindable props plus `bindTriggerSave(fn)`. The host renders
     * the save UI in its own chrome (e.g. a shared plugin page header).
     */
    externalSaveBar?: boolean;
    dirty?: boolean;
    saving?: boolean;
    saveError?: string | null;
    saveOk?: boolean;
    restartRequired?: boolean;
    /** Receives a `() => void` that the host can call to invoke save. */
    bindTriggerSave?: (fn: () => void) => void;
    /**
     * Fill the parent container vertically and let the iframe scroll itself,
     * rather than growing the iframe to fit reported content height (the
     * default). Needed when plugins render `position: fixed` modals — those
     * resolve to the iframe's viewport, so a grow-to-content iframe puts the
     * modal at the middle of the long content instead of the visible area.
     */
    fillContainer?: boolean;
  }

  let {
    pluginId,
    entrypoint,
    gatewayUrl,
    authToken,
    theme,
    tokens,
    externalSaveBar = false,
    dirty = $bindable(false),
    saving = $bindable(false),
    saveError = $bindable<string | null>(null),
    saveOk = $bindable(false),
    restartRequired = $bindable(false),
    bindTriggerSave,
    fillContainer = false,
  }: Props = $props();

  let iframeEl: HTMLIFrameElement | null = $state(null);
  // Plain `let` (not $state) — the bridge-mount $effect both reads
  // `mounted?.dispose()` and writes `mounted = ...`. Making this reactive
  // creates an infinite re-run loop ("updated at PluginIframe.svelte" warning
  // in console) and the iframe never settles.
  let mounted: MountedHostBridge | null = null;
  let height = $state(600);

  // Hub-rendered save bar state. Plugins emit `plugin:dirty-changed` on every
  // config edit; we render the save button (sticky at top) whenever dirty —
  // unless `externalSaveBar` is set, in which case the host hoists the state
  // up via bindable props and renders the save UI itself.
  let pendingSaveId = $state<string | null>(null);
  let saveOkTimer: ReturnType<typeof setTimeout> | null = null;

  function triggerSave() {
    if (!mounted || saving || !dirty) return;
    saving = true;
    saveError = null;
    saveOk = false;
    restartRequired = false;
    pendingSaveId = mounted.requestSave();
  }

  $effect(() => {
    bindTriggerSave?.(triggerSave);
  });

  // Handshake observability: track which stages of the iframe→bridge handshake
  // have happened. If `plugin:ready` doesn't arrive within HANDSHAKE_TIMEOUT_MS
  // we render a diagnostic overlay instead of leaving the user staring at the
  // plugin's "Loading…" screen with no actionable info.
  // A cold remote gateway (Tailscale) parsing a Svelte/PixiJS bundle can take a
  // few seconds; 2.5s was too tight and produced false "timed out" overlays.
  const HANDSHAKE_TIMEOUT_MS = 6000;
  let iframeLoaded = $state(false);
  let pluginReady = $state(false);
  let handshakeTimedOut = $state(false);
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  // HTTP status of the plugin UI URL, probed server-side on timeout. A 404 here
  // is the most common real failure (plugin not deployed/enabled on this
  // gateway) and was previously misreported as a bridge/Referrer/WS problem.
  let diagnosticHttpStatus = $state<number | null>(null);
  // Populated on timeout by a HEAD fetch of the iframe URL. Surfaces the
  // single most common silent-failure mode: gateway sets
  // `Content-Security-Policy: frame-ancestors 'none'` (the historical default
  // when gateway.json omits `pluginUi.allowedFrameAncestors`), Chrome blocks
  // the embed *after* the network request completes, the iframe `onload` event
  // still fires, the plugin JS never executes, no `plugin:ready` is sent, and
  // the user is left with no clue what went wrong.
  let diagnosticCsp = $state<string | null>(null);
  let diagnosticCspBlocks = $state(false);

  // Gateway serves /plugins/<id>/ui/<subpath> resolving against ui/dist/.
  // Some manifests list entrypoint as "ui/dist/index.html" (disk path); strip
  // that prefix so the URL is just /plugins/<id>/ui/index.html.
  const subpath = $derived(entrypoint.replace(/^ui\/dist\//, "").replace(/^\/+/, ""));
  // Pass the host origin via URL hash so the plugin can validate inbound
  // postMessage events without depending on document.referrer (which is
  // stripped under strict Referrer-Policy for cross-origin iframes — that
  // failure mode silently bricks the plugin's bridge handshake).
  const hostOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const srcBase = $derived(`${gatewayUrl}/plugins/${pluginId}/ui/${subpath}`);
  const src = $derived(
    hostOrigin ? `${srcBase}#hostOrigin=${encodeURIComponent(hostOrigin)}` : srcBase,
  );
  const pluginOrigin = $derived(new URL(gatewayUrl).origin);
  // hello.gatewayUrl is consumed by the plugin's WebSocket client. The hub
  // surfaces gatewayUrl as HTTP(S) because it's also used to derive the
  // pluginOrigin for postMessage targeting; the plugin needs the ws(s):
  // equivalent. Convert here so plugins don't have to think about it.
  const wsGatewayUrl = $derived(gatewayUrl.replace(/^http/, "ws"));

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
        if (!fillContainer) height = h;
      },
      onPluginReady: () => {
        pluginReady = true;
        if (timeoutHandle !== null) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
      },
      onDirtyChanged: (d) => {
        dirty = d;
        // Reverting clears any stale post-save status indicator.
        if (!d) {
          saveError = null;
          saveOk = false;
          restartRequired = false;
        }
      },
      onSaveResult: (id, ok, error, restart) => {
        if (pendingSaveId && id !== pendingSaveId) return;
        saving = false;
        pendingSaveId = null;
        if (ok) {
          saveOk = true;
          restartRequired = !!restart;
          if (saveOkTimer) clearTimeout(saveOkTimer);
          saveOkTimer = setTimeout(() => {
            saveOk = false;
            saveOkTimer = null;
          }, 2500);
        } else {
          saveError = error ?? "Save failed";
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
          // Probe the plugin UI URL from the hub server (no CORS) so we get the
          // true HTTP status + CSP. A 4xx/5xx here means the gateway isn't
          // serving the plugin (not deployed/enabled) — the real cause, which a
          // cross-origin client fetch could never read.
          const probeUrl = `/api/plugins/probe?pluginId=${encodeURIComponent(
            pluginId,
          )}&subpath=${encodeURIComponent(subpath)}`;
          void fetch(probeUrl)
            .then((r) => (r.ok ? r.json() : null))
            .then((info: { status?: number; csp?: string | null } | null) => {
              if (!info) return;
              if (typeof info.status === "number") diagnosticHttpStatus = info.status;
              const csp = info.csp;
              if (!csp) return;
              diagnosticCsp = csp;
              const m = /frame-ancestors\s+([^;]+)/i.exec(csp);
              if (!m) return;
              const ancestors = m[1]!.trim();
              if (ancestors.includes("'none'")) {
                diagnosticCspBlocks = true;
                return;
              }
              if (ancestors.includes("*")) return;
              if (hostOrigin && !ancestors.includes(hostOrigin)) {
                diagnosticCspBlocks = true;
              }
            })
            .catch(() => {});
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
    if (saveOkTimer !== null) {
      clearTimeout(saveOkTimer);
      saveOkTimer = null;
    }
  });
</script>

<div
  class="relative flex w-full flex-col"
  class:h-full={fillContainer}
  class:min-h-0={fillContainer}
>
  {#if !externalSaveBar && (dirty || saving || saveError || saveOk)}
    <div
      class="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border bg-card/95 px-4 py-2.5 backdrop-blur"
    >
      <div class="flex items-center gap-2 text-sm">
        {#if saving}
          <Loader2 size={14} class="animate-spin text-muted-foreground" />
          <span class="text-muted-foreground">{m.pluginIframe_saving()}</span>
        {:else if saveError}
          <AlertTriangle size={14} class="text-destructive" />
          <span class="text-destructive">{saveError}</span>
        {:else if saveOk}
          <Check size={14} class="text-emerald-500" />
          <span class="text-foreground">
            {restartRequired ? m.pluginIframe_savedRestartRequired() : m.pluginIframe_saved()}.
          </span>
        {:else if dirty}
          <span class="inline-block h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true"></span>
          <span class="text-muted-foreground">{m.pluginIframe_unsavedChanges()}</span>
        {/if}
      </div>
      <button
        type="button"
        onclick={triggerSave}
        disabled={saving || !dirty}
        class="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {#if saving}
          <RotateCw size={12} class="animate-spin" />
        {/if}
        {saving ? m.pluginIframe_saving() : m.pluginIframe_saveChanges()}
      </button>
    </div>
  {/if}
  {#if fillContainer}
    <div class="relative flex-1 min-h-0">
      <iframe
        bind:this={iframeEl}
        title={m.pluginIframe_pluginTitle({id: pluginId})}
        {src}
        referrerpolicy="strict-origin"
        onload={() => {
          iframeLoaded = true;
        }}
        class="absolute inset-0 w-full h-full border-0"
      ></iframe>
    </div>
  {:else}
    <iframe
      bind:this={iframeEl}
      title={m.pluginIframe_pluginTitle({id: pluginId})}
      {src}
      referrerpolicy="strict-origin"
      onload={() => {
        iframeLoaded = true;
      }}
      style:height={`${height}px`}
      class="w-full border-0"
    ></iframe>
  {/if}
  {#if handshakeTimedOut && !pluginReady}
    <div
      class="bg-background/95 absolute inset-0 z-10 flex items-start justify-center overflow-auto p-6 backdrop-blur"
    >
      <div class="max-w-xl space-y-3 rounded-md border border-destructive/50 bg-card p-4 text-sm">
        <header class="font-semibold text-destructive">
          Plugin handshake timed out ({HANDSHAKE_TIMEOUT_MS / 1000}s)
        </header>
        {#if diagnosticHttpStatus !== null && diagnosticHttpStatus >= 400}
          <p class="text-foreground">
            <strong>The gateway returned HTTP {diagnosticHttpStatus} for this plugin's UI.</strong>
            The plugin is not being served by this gateway — its UI assets are missing or the
            plugin isn't enabled/registered here. The iframe loaded the gateway's error page (no
            plugin JS), so <code>plugin:ready</code> was never sent. This is a deployment gap, not a
            bridge bug.
          </p>
          <p class="text-muted-foreground">
            Fix on the gateway: ensure the <code>{pluginId}</code> plugin is enabled in
            <code>gateway.json</code> and its <code>ui/dist</code> assets are deployed, then restart
            the gateway. Verify with <code>curl -I {src.split("#")[0]}</code> (expect 200).
          </p>
        {:else if diagnosticCspBlocks}
          <p class="text-foreground">
            <strong>Gateway CSP blocks this hub from embedding the plugin.</strong> The plugin
            served a <code>frame-ancestors</code> directive that excludes
            <code>{hostOrigin}</code>. The iframe request succeeded, but Chrome refuses to render —
            so the plugin's JS never runs and <code>plugin:ready</code> is never sent.
          </p>
          <p class="text-muted-foreground">
            Fix on the gateway side: set <code>gateway.pluginUi.allowedFrameAncestors</code> in
            <code>gateway.json</code> to include this hub's origin (or <code>"*"</code>), then
            restart the gateway. Recent gateway builds default to <code>*</code> when this key is
            absent — older deployments that hardcoded <code>'none'</code> need a config change or
            a redeploy.
          </p>
          {#if diagnosticCsp}
            <pre
              class="overflow-x-auto rounded bg-muted p-2 text-xs">{diagnosticCsp}</pre>
          {/if}
        {:else}
          <p class="text-muted-foreground">
            The plugin loaded its assets but did not send <code>plugin:ready</code> in time, or its
            <code>host:hello</code> reply was rejected. Common causes: cross-origin Referrer-Policy
            stripped the host origin, the plugin throws before <code>bridge.notifyReady()</code>,
            or the plugin's gateway WebSocket fails immediately.
          </p>
        {/if}
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
          {#if diagnosticHttpStatus !== null}
            <dt class="text-muted-foreground">UI http status</dt>
            <dd>{diagnosticHttpStatus}</dd>
          {/if}
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
