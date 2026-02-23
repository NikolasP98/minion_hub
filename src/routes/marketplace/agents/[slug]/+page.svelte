<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { hostsState } from '$lib/state/hosts.svelte';
  import {
    loadAgent,
    installAgent,
    marketplaceState,
    parseTags,
    type MarketplaceAgent,
  } from '$lib/state/marketplace.svelte';
  import { diceBearAvatarUrl } from '$lib/utils/avatar';

  const slug = $derived($page.params.slug);
  const initialTab = $derived(($page.url.searchParams.get('tab') ?? 'overview') as Tab);

  type Tab = 'overview' | 'documents' | 'install';
  type DocTab = 'soul' | 'identity' | 'user' | 'context' | 'skills';

  let agent = $state<MarketplaceAgent | null>(null);
  let loading = $state(true);
  let activeTab = $state<Tab>('overview');
  let activeDocTab = $state<DocTab>('soul');
  let selectedServerId = $state<string>('');
  let installSuccess = $state(false);
  let installError = $state<string | null>(null);

  const tags = $derived(agent ? parseTags(agent.tags) : []);
  const avatarUrl = $derived(agent ? diceBearAvatarUrl(agent.avatarSeed) : '');

  const docTabs: { id: DocTab; label: string; field: keyof MarketplaceAgent }[] = [
    { id: 'soul', label: 'SOUL', field: 'soulMd' },
    { id: 'identity', label: 'IDENTITY', field: 'identityMd' },
    { id: 'user', label: 'USER', field: 'userMd' },
    { id: 'context', label: 'CONTEXT', field: 'contextMd' },
    { id: 'skills', label: 'SKILLS', field: 'skillsMd' },
  ];

  onMount(async () => {
    activeTab = initialTab;
    if (hostsState.hosts.length > 0) {
      selectedServerId = hostsState.hosts[0].id;
    }

    const data = await loadAgent(slug as string);
    agent = data;
    loading = false;
  });

  // Simple markdown renderer — handles headings, bold, italic, code, lists
  function renderMd(md: string | null | undefined): string {
    if (!md) return '<p class="text-muted text-xs italic">No content available.</p>';
    return md
      .replace(/^#{3}\s+(.+)$/gm, '<h3 class="text-sm font-semibold text-foreground mt-4 mb-1">$1</h3>')
      .replace(/^#{2}\s+(.+)$/gm, '<h2 class="text-base font-bold text-foreground mt-5 mb-2">$1</h2>')
      .replace(/^#{1}\s+(.+)$/gm, '<h1 class="text-lg font-bold text-foreground mt-6 mb-2">$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong class="text-foreground font-semibold">$1</strong>')
      .replace(/\*(.+?)\*/g, '<em class="text-muted italic">$1</em>')
      .replace(/`(.+?)`/g, '<code class="px-1 py-0.5 rounded bg-bg3 text-brand-pink text-[11px] font-mono">$1</code>')
      .replace(/^[-*]\s+(.+)$/gm, '<li class="ml-4 text-xs text-foreground/80 list-disc list-outside">$1</li>')
      .replace(/(<li.*<\/li>)/gs, '<ul class="my-2 space-y-1">$1</ul>')
      .replace(/\n{2,}/g, '</p><p class="text-xs text-foreground/80 leading-relaxed mb-2">')
      .replace(/^(?!<[hulo])(.+)$/gm, '$1')
      .replace(/^(.+(?!\n))$/gm, (line) => {
        if (line.startsWith('<')) return line;
        return `<p class="text-xs text-foreground/80 leading-relaxed mb-2">${line}</p>`;
      });
  }

  async function handleInstall() {
    if (!selectedServerId || !agent) return;
    installError = null;
    installSuccess = false;

    const host = hostsState.hosts.find((h) => h.id === selectedServerId);
    const ok = await installAgent(agent.id, selectedServerId, host?.name, host?.url);
    if (ok) {
      installSuccess = true;
    } else {
      installError = marketplaceState.installError;
    }
  }

  function formatInstallCount(n: number | null): string {
    const count = n ?? 0;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
    return String(count);
  }
</script>

{#if loading}
  <div class="flex items-center justify-center h-full py-20 text-muted text-sm gap-2">
    <span class="animate-spin">↻</span>
    Loading…
  </div>

{:else if !agent}
  <div class="flex flex-col items-center justify-center h-full py-20 gap-3">
    <p class="text-sm text-foreground">Agent not found</p>
    <button
      type="button"
      onclick={() => goto('/marketplace/agents')}
      class="text-xs text-brand-pink hover:underline"
    >
      ← Back to agents
    </button>
  </div>

{:else}
  <div class="max-w-3xl mx-auto px-6 py-8 flex flex-col gap-6">
    <!-- Back -->
    <button
      type="button"
      onclick={() => goto('/marketplace/agents')}
      class="self-start text-xs text-muted hover:text-foreground transition-colors flex items-center gap-1"
    >
      ← All agents
    </button>

    <!-- Header card -->
    <div class="bg-bg2 border border-border rounded-xl p-6 flex gap-6 items-start">
      <!-- Avatar -->
      <div class="w-[120px] h-[120px] shrink-0 rounded-full bg-bg3 border border-border overflow-hidden">
        <img src={avatarUrl} alt={agent.name} class="w-full h-full object-cover" />
      </div>

      <!-- Info -->
      <div class="flex-1 min-w-0">
        <div class="flex items-start gap-2 flex-wrap">
          <h1 class="text-2xl font-bold text-foreground">{agent.name}</h1>
          <span class="mt-1 px-2 py-0.5 rounded-full text-[10px] border border-border text-muted bg-bg3">v{agent.version}</span>
          {#if agent.model}
            <span class="mt-1 px-2 py-0.5 rounded-full text-[10px] border border-brand-pink/20 text-brand-pink bg-brand-pink/5">{agent.model}</span>
          {/if}
        </div>
        <p class="text-sm text-muted mt-0.5">{agent.role}</p>
        {#if agent.catchphrase}
          <p class="text-sm italic text-brand-pink mt-2">"{agent.catchphrase}"</p>
        {/if}
        <div class="flex flex-wrap gap-1.5 mt-3">
          {#each tags as tag}
            <span class="px-2 py-0.5 rounded text-[10px] bg-bg3 text-muted border border-border/50">{tag}</span>
          {/each}
        </div>
        <div class="flex items-center gap-4 mt-3 text-[11px] text-muted">
          <span>📥 {formatInstallCount(agent.installCount)} installs</span>
          <span class="capitalize">★ {agent.category}</span>
        </div>
      </div>
    </div>

    <!-- Tab bar -->
    <div class="flex gap-0 border-b border-border">
      {#each (['overview', 'documents', 'install'] as const) as tab}
        <button
          type="button"
          onclick={() => { activeTab = tab; }}
          class="px-4 py-2 text-xs font-medium border-b-2 transition-colors duration-100 capitalize -mb-px {activeTab === tab ? 'border-brand-pink text-brand-pink' : 'border-transparent text-muted hover:text-foreground'}"
        >
          {tab}
        </button>
      {/each}
    </div>

    <!-- Tab content -->
    {#if activeTab === 'overview'}
      <div class="flex flex-col gap-4">
        <div class="bg-bg2 border border-border rounded-xl p-5">
          <h2 class="text-xs font-semibold uppercase tracking-wider text-muted mb-3">About</h2>
          <p class="text-sm text-foreground/80 leading-relaxed">{agent.description}</p>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="bg-bg2 border border-border rounded-xl p-4">
            <p class="text-[10px] uppercase tracking-wider text-muted mb-1">Category</p>
            <p class="text-sm text-foreground capitalize">{agent.category}</p>
          </div>
          <div class="bg-bg2 border border-border rounded-xl p-4">
            <p class="text-[10px] uppercase tracking-wider text-muted mb-1">Version</p>
            <p class="text-sm text-foreground">{agent.version}</p>
          </div>
          {#if agent.model}
            <div class="bg-bg2 border border-border rounded-xl p-4">
              <p class="text-[10px] uppercase tracking-wider text-muted mb-1">Model</p>
              <p class="text-sm text-foreground">{agent.model}</p>
            </div>
          {/if}
          <div class="bg-bg2 border border-border rounded-xl p-4">
            <p class="text-[10px] uppercase tracking-wider text-muted mb-1">Source</p>
            <p class="text-sm text-foreground font-mono truncate">{agent.githubPath}</p>
          </div>
        </div>
      </div>

    {:else if activeTab === 'documents'}
      <!-- Doc sub-tabs -->
      <div class="flex gap-1 bg-bg2 border border-border rounded-lg p-1">
        {#each docTabs as dt}
          <button
            type="button"
            onclick={() => { activeDocTab = dt.id; }}
            class="flex-1 py-1 text-[11px] font-mono font-medium rounded transition-colors duration-100 {activeDocTab === dt.id ? 'bg-brand-pink/10 text-brand-pink' : 'text-muted hover:text-foreground'}"
          >
            {dt.label}
          </button>
        {/each}
      </div>

      <!-- Doc content -->
      <div class="bg-bg2 border border-border rounded-xl p-5 min-h-[300px]">
        {#each docTabs as dt}
          {#if activeDocTab === dt.id}
            <div class="prose-custom">
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              {@html renderMd(agent[dt.field] as string | null)}
            </div>
          {/if}
        {/each}
      </div>

    {:else if activeTab === 'install'}
      <div class="bg-bg2 border border-border rounded-xl p-5 flex flex-col gap-4">
        <div>
          <h2 class="text-sm font-semibold text-foreground mb-1">Provision Agent</h2>
          <p class="text-xs text-muted">Choose a connected server to install {agent.name} onto.</p>
        </div>

        {#if hostsState.hosts.length === 0}
          <div class="rounded-lg border border-border/50 bg-bg3 p-4 text-xs text-muted text-center">
            No servers connected. Add a server in the main Hub to install agents.
          </div>
        {:else}
          <div class="flex flex-col gap-2">
            <label class="text-xs text-muted" for="server-select">Select server</label>
            <select
              id="server-select"
              bind:value={selectedServerId}
              class="w-full px-3 py-2 rounded-lg border border-border bg-bg3 text-sm text-foreground focus:outline-none focus:border-brand-pink/40 transition-colors"
            >
              {#each hostsState.hosts as host}
                <option value={host.id}>{host.name} — {host.url}</option>
              {/each}
            </select>
          </div>

          {#if installSuccess}
            <div class="rounded-lg border border-green-500/20 bg-green-500/5 p-3 text-xs text-green-400 flex items-center gap-2">
              <span>✓</span>
              {agent.name} installed successfully!
            </div>
          {/if}

          {#if installError}
            <div class="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-400">
              {installError}
            </div>
          {/if}

          <button
            type="button"
            onclick={handleInstall}
            disabled={marketplaceState.installing || !selectedServerId}
            class="w-full py-2.5 rounded-lg bg-brand-pink text-black text-sm font-semibold hover:bg-brand-pink/90 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {#if marketplaceState.installing}
              <span class="animate-spin text-base">↻</span>
              Provisioning…
            {:else}
              Provision Agent
            {/if}
          </button>
        {/if}
      </div>
    {/if}
  </div>
{/if}
