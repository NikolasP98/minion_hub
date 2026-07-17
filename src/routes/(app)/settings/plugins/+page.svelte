<script lang="ts">
  import { Button, Toggle } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import {
    Puzzle,
    AlertTriangle,
    Copy,
    Check,
    RefreshCw,
    PlugZap,
    ArrowUpRight,
    ServerCrash,
    Loader2,
  } from 'lucide-svelte';
  import { BRAND_ICON_SET, PLUGIN_ICON_MAP } from '$lib/plugins/icon-map';
  import ChannelBrandIcon from '$lib/components/channels/ChannelBrandIcon.svelte';
  import PluginIframe from '$lib/plugins/PluginIframe.svelte';
  import type { Theme } from '$lib/plugins/bridge-protocol';
  import { hostsState, fetchHostToken } from '$lib/state/features/hosts.svelte';
  import { setPluginEnabled } from '$lib/state/plugin-nav.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // Snapshot the hub theme + every CSS custom property declared on :root so
  // plugin iframes can inherit the live design tokens. Plain `let` (not
  // $derived/$state) — the values are read once when PluginIframe mounts and
  // making them reactive would tear down the bridge on every read.
  // svelte-ignore non_reactive_update
  let theme: Theme = 'light';
  let tokens: Record<string, string> = {};
  if (typeof document !== 'undefined') {
    theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    const root = document.documentElement;
    const computed = getComputedStyle(root);
    // Hub theme runtime sets `--color-*` / `--theme-*` etc as INLINE styles on
    // <html>, not in stylesheets. Walk inline first.
    for (const name of Array.from(root.style)) {
      if (name.startsWith('--')) tokens[name] = root.style.getPropertyValue(name).trim();
    }
    // Then sweep any same-origin stylesheet `:root` blocks (CSS-defined tokens
    // like Tailwind's --radius). Inline values override since they're set last.
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of Array.from(rules)) {
        if (!(rule instanceof CSSStyleRule)) continue;
        if (!/^:root\b/.test(rule.selectorText)) continue;
        for (const name of Array.from(rule.style)) {
          if (name.startsWith('--') && !(name in tokens))
            tokens[name] = computed.getPropertyValue(name).trim();
        }
      }
    }
  }

  let selected = $state(0);
  const current = $derived(data.entries[selected]);

  // Auto-select the entry matching `?plugin=<id>` so deep-links from elsewhere
  // (e.g. the Comms tab's "Plugin settings" CTA) land directly on the right
  // plugin instead of always opening the first entry. Re-runs if the URL
  // changes — `page.url` is reactive in Svelte 5 / Sveltekit `$app/state`.
  $effect(() => {
    const target = page.url.searchParams.get('plugin');
    if (!target) return;
    const idx = data.entries.findIndex((e) => e.pluginId === target);
    if (idx >= 0 && idx !== selected) selected = idx;
  });

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

  // Per-plugin local override of `enabled` after a successful toggle. Avoids a
  // full `invalidateAll()` round-trip (which would tear down the iframe) and
  // keeps the row visible even though the gateway list will only refresh after
  // restart. Keyed by pluginId.
  let enabledOverrides = $state<Record<string, boolean>>({});
  let togglingId = $state<string | null>(null);
  let toggleError = $state<string | null>(null);
  let restartRequired = $state(false);

  function effectiveEnabled(entry: {
    pluginId: string;
    enabled?: boolean;
    configEnabled?: boolean;
    orgEnabled?: boolean;
  }): boolean {
    if (entry.pluginId in enabledOverrides) return enabledOverrides[entry.pluginId];
    // Per-org state is the source of truth (the toggle is org-scoped). Fall back
    // to the global soft master, then load-level enabled, for older gateways.
    if (typeof entry.orgEnabled === 'boolean') return entry.orgEnabled;
    if (typeof entry.configEnabled === 'boolean') return entry.configEnabled;
    return entry.enabled !== false;
  }

  async function toggleEnabled(entry: { pluginId: string; enabled?: boolean }) {
    const next = !effectiveEnabled(entry);
    togglingId = entry.pluginId;
    toggleError = null;
    try {
      const res = await fetch(`/api/plugins/${encodeURIComponent(entry.pluginId)}/toggle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        restartRequired?: boolean;
        errors?: string[];
        error?: string;
      };
      if (!res.ok || body.ok === false) {
        toggleError = body.error ?? body.errors?.join('; ') ?? `HTTP ${res.status}`;
        return;
      }
      enabledOverrides = { ...enabledOverrides, [entry.pluginId]: next };
      // Reflect the per-org change in the shared nav store so the side-menu
      // dims/undims this plugin reactively — no reload, no gateway restart.
      setPluginEnabled(entry.pluginId, next);
      if (body.restartRequired) restartRequired = true;
    } catch (err) {
      toggleError = err instanceof Error ? err.message : String(err);
    } finally {
      togglingId = null;
    }
  }

  function statusDotClass(entry: {
    pluginId: string;
    enabled?: boolean;
    status?: string;
    pluginError?: string;
  }): string {
    if (entry.status === 'error' || entry.pluginError) return 'bg-destructive';
    if (!effectiveEnabled(entry)) return 'bg-muted-foreground/40';
    return 'bg-success';
  }

  function statusLabel(entry: {
    pluginId: string;
    enabled?: boolean;
    status?: string;
    pluginError?: string;
  }): string {
    if (entry.status === 'error' || entry.pluginError) return 'Error';
    if (!effectiveEnabled(entry)) return 'Disabled';
    if (entry.status === 'loaded') return 'Loaded';
    return entry.status ?? 'Unknown';
  }

  // Save bar state hoisted out of PluginIframe via bindable props so the new
  // header can host the Save button alongside the on/off toggle (avoids the
  // duplicate-header that PluginIframe's internal sticky bar produced).
  let saveDirty = $state(false);
  let saveSaving = $state(false);
  let saveError = $state<string | null>(null);
  let saveOk = $state(false);
  let saveRestart = $state(false);
  let triggerSaveFn: (() => void) | null = $state(null);

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

<div class="flex min-h-0 flex-1 flex-col p-6 md:p-10">
  <div class="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-4">
    <header class="space-y-1">
      <div class="flex items-center gap-2">
        <PlugZap size={20} class="text-muted-foreground" />
        <h1 class="text-2xl font-semibold">{m.pluginsPage_title()}</h1>
      </div>
      <p class="text-sm text-muted-foreground">
        {m.pluginsPage_subtitle()}
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
                  {m.pluginsPage_originNotAllowed()}
                {:else if data.errorKind === 'unreachable'}
                  {m.pluginsPage_unreachable()}
                {:else}
                  {m.pluginsPage_loadFailed()}
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
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onclick={copySnippet}
                    class="absolute right-2 top-2"
                    aria-label={m.a11y0_copySnippet()}
                  >
                    {#if copied}
                      <Check size={12} /> {m.pluginsPage_copied()}
                    {:else}
                      <Copy size={12} /> {m.pluginsPage_copy()}
                    {/if}
                  </Button>
                </div>
                <p class="text-xs text-muted-foreground">
                  {m.pluginsPage_restartMessage()}
                </p>
              </div>
            {/if}

            <div class="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                type="button"
                onclick={refresh}
                loading={refreshing}
              >
                {refreshing ? m.pluginsPage_retrying() : m.common_retry()}
              </Button>
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
          <p class="text-sm font-medium">{m.pluginsPage_empty()}</p>
          <p class="max-w-sm text-xs text-muted-foreground">
            {m.pluginsPage_emptyDescription()}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          href="/marketplace/plugins"
          class="mt-1"
        >
          {m.pluginsPage_browseMarketplace()} <ArrowUpRight size={12} />
        </Button>
      </div>
    {/if}

    {#if data.entries.length > 0}
      <div class="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card">
        <div class="grid min-h-0 w-full grid-cols-1 md:grid-cols-[16rem_1fr]">
          <nav
            class="min-h-0 overflow-y-auto border-b border-border md:border-b-0 md:border-r"
            aria-label={m.pluginsPage_navLabel()}
          >
            <ul class="flex flex-row overflow-x-auto md:flex-col md:overflow-x-visible">
              {#each data.entries as entry, i (entry.pluginId + ':' + entry.entrypoint)}
                {@const active = selected === i}
                <li>
                  <!-- Selection = accent-TINTED surface + accent text (house pattern,
                       same as the sidebar nav) — never a full accent fill: on-accent
                       is near-black on most themes and drowns icons/status dots. -->
                  <Button
                    variant="ghost"
                    type="button"
                    onclick={() => (selected = i)}
                    aria-current={active ? 'page' : undefined}
                    class="group relative !h-auto !w-full !justify-start !rounded-none !px-4 !py-3 text-left {active
                      ? '!bg-accent/10'
                      : ''}"
                  >
                    <span
                      class="mt-0.5 inline-flex items-center justify-center text-base leading-none"
                      class:text-muted-foreground={!active}
                      class:text-accent={active}
                    >
                      {#if entry.icon && /\p{Extended_Pictographic}/u.test(entry.icon)}
                        {entry.icon}
                      {:else if entry.icon && BRAND_ICON_SET.has(entry.icon)}
                        <ChannelBrandIcon channel={entry.icon} size={14} />
                      {:else if entry.icon && PLUGIN_ICON_MAP[entry.icon]}
                        {@const IconComp = PLUGIN_ICON_MAP[entry.icon]}
                        <IconComp size={14} />
                      {:else}
                        <Puzzle size={14} />
                      {/if}
                    </span>
                    <span class="group/dot relative mt-1.5 shrink-0">
                      <span
                        class="block size-2 rounded-full ring-2 ring-card transition-colors {statusDotClass(
                          entry,
                        )}"
                        aria-label={statusLabel(entry)}
                      ></span>
                      <span
                        role="tooltip"
                        class="pointer-events-none absolute left-1/2 top-full z-[var(--layer-popover)] mt-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2.5 py-1.5 text-left text-xs leading-tight text-popover-foreground shadow-lg group-hover/dot:block"
                      >
                        <span class="flex items-center gap-1.5 font-medium">
                          <span class="size-1.5 rounded-full {statusDotClass(entry)}"></span>
                          {statusLabel(entry)}
                        </span>
                        <span class="mt-1 block font-mono text-xs text-muted-foreground"
                          >{entry.pluginId}{entry.pluginVersion
                            ? ` · v${entry.pluginVersion}`
                            : ''}</span
                        >
                        {#if entry.pluginError}
                          <span class="mt-1 block max-w-[18rem] whitespace-normal text-destructive"
                            >{entry.pluginError}</span
                          >
                        {/if}
                      </span>
                    </span>
                    <span class="min-w-0 flex-1">
                      <span
                        class="block truncate font-medium"
                        class:text-foreground={!active}
                        class:text-accent={active}
                      >{entry.title}</span>
                      {#if entry.description}
                        <span class="mt-0.5 block truncate text-xs text-muted-foreground">
                          {entry.description}
                        </span>
                      {/if}
                      <span class="mt-1 block truncate font-mono text-xs text-muted-foreground">
                        {entry.pluginId}
                      </span>
                    </span>
                  </Button>
                </li>
              {/each}
            </ul>
          </nav>

          <div class="flex min-h-0 min-w-0 flex-col">
            {#if current}
              {@const on = effectiveEnabled(current)}
              {@const busy = togglingId === current.pluginId}
              <div
                class="flex items-center justify-end gap-3 border-b border-border px-4 py-2"
              >
                {#if tokenLoading}
                  <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <RefreshCw size={12} class="animate-spin" /> {m.pluginsPage_authenticating()}
                  </span>
                {:else if tokenError}
                  <span class="text-xs text-destructive">Auth: {tokenError}</span>
                {/if}
                {#if saveSaving}
                  <span class="flex items-center gap-1.5 text-xs">
                    <Loader2 size={12} class="animate-spin text-muted-foreground" />
                    <span class="text-muted-foreground">{m.pluginsPage_saving()}</span>
                  </span>
                {:else if saveError}
                  <span class="flex items-center gap-1.5 text-xs">
                    <AlertTriangle size={12} class="text-destructive" />
                    <span class="text-destructive">{saveError}</span>
                  </span>
                {:else if saveOk}
                  <span class="flex items-center gap-1.5 text-xs">
                    <Check size={12} class="text-success" />
                    <span class="text-foreground"
                      >{saveRestart ? m.pluginsPage_savedRestart() : m.pluginsPage_saved()}</span
                    >
                  </span>
                {:else if saveDirty}
                  <span class="flex items-center gap-1.5 text-xs">
                    <span
                      class="inline-block h-1.5 w-1.5 rounded-full bg-accent"
                      aria-hidden="true"
                    ></span>
                    <span class="text-muted-foreground">{m.pluginsPage_unsavedChanges()}</span>
                  </span>
                {/if}
                {#if saveDirty || saveSaving}
                  <Button
                    variant="primary"
                    size="sm"
                    type="button"
                    onclick={() => triggerSaveFn?.()}
                    loading={saveSaving}
                    disabled={!saveDirty}
                  >
                    {saveSaving ? m.pluginsPage_saving() : m.pluginsPage_saveButton()}
                  </Button>
                {/if}
                <Toggle
                  checked={on}
                  ariaLabel={`${on ? m.pluginsPage_disable() : m.pluginsPage_enable()} ${current.title}`}
                  disabled={busy}
                  onchange={() => toggleEnabled(current)}
                  size="sm"
                />
              </div>
              {#if toggleError}
                <div
                  class="border-b border-destructive/40 bg-destructive/5 px-4 py-2 text-xs text-destructive"
                  role="alert"
                >
                  {m.pluginsPage_toggleFailed()}: {toggleError}
                </div>
              {/if}
              {#if restartRequired}
                <div
                  class="flex items-center gap-2 border-b border-warning/40 bg-warning/5 px-4 py-2 text-xs text-warning"
                >
                  <AlertTriangle size={12} />
                  {m.pluginsPage_restartRequired()}
                </div>
              {/if}
              {#if tokenLoading}
                <div class="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                  <RefreshCw size={14} class="animate-spin" />
                  {m.pluginsPage_fetchingToken()}
                </div>
              {:else if !authToken && !tokenError}
                <div class="px-4 py-6 text-sm text-muted-foreground">
                  {m.pluginsPage_noHost()}
                </div>
              {:else}
                <div class="flex min-h-0 flex-1 flex-col">
                  {#key current.pluginId + ':' + current.entrypoint}
                    <PluginIframe
                      pluginId={current.pluginId}
                      entrypoint={current.entrypoint}
                      gatewayUrl={data.gatewayBaseUrl}
                      {authToken}
                      {theme}
                      {tokens}
                      compat={current.compat}
                      pluginStatus={current.status}
                      externalSaveBar
                      fillContainer
                      bind:dirty={saveDirty}
                      bind:saving={saveSaving}
                      bind:saveError
                      bind:saveOk
                      bind:restartRequired={saveRestart}
                      bindTriggerSave={(fn) => (triggerSaveFn = fn)}
                    />
                  {/key}
                </div>
              {/if}
            {/if}
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>
