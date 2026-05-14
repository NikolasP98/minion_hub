<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import {
    Puzzle,
    AlertTriangle,
    Copy,
    Check,
    RefreshCw,
    PlugZap,
    ArrowUpRight,
    ServerCrash,
  } from 'lucide-svelte';
  import PluginIframe from '$lib/plugins/PluginIframe.svelte';
  import type { Theme } from '$lib/plugins/bridge-protocol';
  import { hostsState, fetchHostToken } from '$lib/state/features/hosts.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // Snapshot the current hub theme + every CSS custom property declared on
  // :root so the plugin iframe can inherit the live design tokens. Plugins
  // that style with `var(--foreground)` etc will match the hub automatically.
  const theme: Theme = $derived(
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light'
  );
  const tokens: Record<string, string> = $derived.by(() => {
    if (typeof document === 'undefined') return {};
    const computed = getComputedStyle(document.documentElement);
    const out: Record<string, string> = {};
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin stylesheet, skip
      }
      for (const rule of Array.from(rules)) {
        if (!(rule instanceof CSSStyleRule)) continue;
        if (!/^:root\b/.test(rule.selectorText)) continue;
        for (const name of Array.from(rule.style)) {
          if (name.startsWith('--')) out[name] = computed.getPropertyValue(name).trim();
        }
      }
    }
    return out;
  });

  let selected = $state(0);
  const current = $derived(data.entries[selected]);

  // Fetch a per-user gateway token for the active host so plugin iframes can
  // open authenticated WS connections to the gateway. Tokens are NOT sent
  // through SSR page data (would leak in HTML); they're fetched on demand
  // from /api/servers/:id/token and forwarded via the bridge hello payload.
  let authToken = $state('');
  let tokenLoading = $state(false);
  let tokenError = $state<string | null>(null);

  $effect(() => {
    const hostId = hostsState.activeHostId;
    if (!hostId || data.entries.length === 0) {
      authToken = '';
      return;
    }
    tokenLoading = true;
    tokenError = null;
    fetchHostToken(hostId)
      .then((tok) => {
        if (tok === null) {
          tokenError = 'session required';
          authToken = '';
        } else {
          authToken = tok;
        }
      })
      .catch((err) => {
        tokenError = String(err);
        authToken = '';
      })
      .finally(() => {
        tokenLoading = false;
      });
  });

  let refreshing = $state(false);
  async function refresh() {
    refreshing = true;
    try {
      await invalidateAll();
    } finally {
      refreshing = false;
    }
  }

  // Build a copy-paste-friendly snippet that the user can drop into
  // ~/.minion/gateway.json under the dotted path
  // gateway.controlUi.allowedOrigins (relative to JSON root). The hint
  // is purely cosmetic — the actual edit happens on the gateway host.
  // Path is `gateway.controlUi.allowedOrigins` and the dotted notation is
  // RELATIVE to JSON root — i.e. `controlUi` lives under a `gateway` key
  // in the file. Patching `controlUi` at root crashes the gateway with
  // "Unrecognized key: controlUi".
  const allowedOriginsSnippet = $derived(
    JSON.stringify(
      { gateway: { controlUi: { allowedOrigins: [data.hubOrigin] } } },
      null,
      2,
    ),
  );

  let copied = $state(false);
  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(allowedOriginsSnippet);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      copied = false;
    }
  }
</script>

<div class="flex-1 overflow-y-auto p-6 md:p-10">
  <div class="mx-auto max-w-4xl space-y-4">
    <header class="space-y-1">
      <div class="flex items-center gap-2">
        <PlugZap size={20} class="text-muted-foreground" />
        <h1 class="text-2xl font-semibold">Plugins</h1>
      </div>
      <p class="text-sm text-muted-foreground">
        Plugins that ship a UI appear here. Their configuration is owned by the plugin itself.
      </p>
    </header>

    {#if data.error}
      <div
        class="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
        role="alert"
      >
        <div class="flex items-start gap-3">
          {#if data.errorKind === 'unreachable'}
            <ServerCrash size={18} class="mt-0.5 shrink-0 text-destructive" />
          {:else}
            <AlertTriangle size={18} class="mt-0.5 shrink-0 text-destructive" />
          {/if}
          <div class="flex-1 space-y-3">
            <div>
              <p class="font-medium text-destructive">
                {#if data.errorKind === 'originNotAllowed'}
                  Gateway rejected this origin
                {:else if data.errorKind === 'unreachable'}
                  Gateway unreachable
                {:else}
                  Failed to load plugin manifest
                {/if}
              </p>
              <p class="mt-1 break-all text-muted-foreground">{data.error}</p>
            </div>

            {#if data.errorKind === 'originNotAllowed'}
              <div class="space-y-2">
                <p class="text-foreground">
                  The hub is loading from
                  <code class="rounded bg-muted px-1.5 py-0.5 text-xs">{data.hubOrigin}</code>.
                  Add it to <code class="rounded bg-muted px-1.5 py-0.5 text-xs"
                    >gateway.controlUi.allowedOrigins</code
                  > on the gateway host (e.g.
                  <code class="rounded bg-muted px-1.5 py-0.5 text-xs"
                    >~/.minion/gateway.json</code
                  >):
                </p>
                <div class="relative">
                  <pre
                    class="overflow-x-auto rounded-md border border-border bg-bg p-3 text-xs"><code
                      >{allowedOriginsSnippet}</code
                    ></pre>
                  <button
                    type="button"
                    onclick={copySnippet}
                    class="absolute right-2 top-2 inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-1 text-xs hover:bg-muted"
                    aria-label="Copy snippet"
                  >
                    {#if copied}
                      <Check size={12} /> Copied
                    {:else}
                      <Copy size={12} /> Copy
                    {/if}
                  </button>
                </div>
                <p class="text-xs text-muted-foreground">
                  Then restart the gateway and click <em>Retry</em>.
                </p>
              </div>
            {/if}

            <div class="flex items-center gap-2">
              <button
                type="button"
                onclick={refresh}
                disabled={refreshing}
                class="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw size={12} class={refreshing ? 'animate-spin' : ''} />
                {refreshing ? 'Retrying…' : 'Retry'}
              </button>
            </div>
          </div>
        </div>
      </div>
    {/if}

    {#if !data.error && data.entries.length === 0}
      <div
        class="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center"
      >
        <div class="rounded-full bg-muted p-3">
          <Puzzle size={22} class="text-muted-foreground" />
        </div>
        <div class="space-y-1">
          <p class="text-sm font-medium">No plugins installed</p>
          <p class="max-w-sm text-xs text-muted-foreground">
            Plugins extend the hub with new pages, widgets, and integrations. Browse the marketplace
            to find one.
          </p>
        </div>
        <a
          href="/marketplace/plugins"
          class="mt-1 inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted"
        >
          Browse marketplace <ArrowUpRight size={12} />
        </a>
      </div>
    {/if}

    {#if data.entries.length > 0}
      <div class="overflow-hidden rounded-lg border border-border bg-card">
        <div class="grid grid-cols-1 md:grid-cols-[16rem_1fr]">
          <nav
            class="border-b border-border md:border-b-0 md:border-r"
            aria-label="Installed plugins"
          >
            <ul class="flex flex-row overflow-x-auto md:flex-col md:overflow-x-visible">
              {#each data.entries as entry, i (entry.pluginId + ':' + entry.entrypoint)}
                <li>
                  <button
                    type="button"
                    onclick={() => (selected = i)}
                    aria-current={selected === i ? 'page' : undefined}
                    class="flex w-full items-start gap-2.5 px-4 py-3 text-left text-sm transition-colors hover:bg-muted"
                    class:bg-muted={selected === i}
                  >
                    <span class="mt-0.5 inline-flex items-center justify-center text-base leading-none text-muted-foreground">
                      {#if entry.icon && /\p{Extended_Pictographic}/u.test(entry.icon)}
                        {entry.icon}
                      {:else}
                        <Puzzle size={14} />
                      {/if}
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block truncate font-medium text-foreground">{entry.title}</span>
                      {#if entry.description}
                        <span class="mt-0.5 block truncate text-xs text-muted-foreground">
                          {entry.description}
                        </span>
                      {/if}
                      <span class="mt-1 block truncate font-mono text-[10px] text-muted-foreground">
                        {entry.pluginId}
                      </span>
                    </span>
                  </button>
                </li>
              {/each}
            </ul>
          </nav>

          <div class="min-w-0">
            {#if current}
              {#if tokenLoading || tokenError}
                <div class="flex items-center justify-end border-b border-border px-4 py-2">
                  {#if tokenLoading}
                    <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <RefreshCw size={12} class="animate-spin" /> Authenticating…
                    </span>
                  {:else if tokenError}
                    <span class="text-xs text-destructive">Auth: {tokenError}</span>
                  {/if}
                </div>
              {/if}
              {#if tokenLoading}
                <div class="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                  <RefreshCw size={14} class="animate-spin" />
                  Fetching gateway token…
                </div>
              {:else if !authToken && !tokenError}
                <div class="px-4 py-6 text-sm text-muted-foreground">
                  No active host. Pick one in the host switcher to load this plugin.
                </div>
              {:else}
                <PluginIframe
                  pluginId={current.pluginId}
                  entrypoint={current.entrypoint}
                  gatewayUrl={data.gatewayBaseUrl}
                  {authToken}
                  {theme}
                  {tokens}
                />
              {/if}
            {/if}
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>
