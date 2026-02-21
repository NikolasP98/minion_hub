<script lang="ts">
  import { goto } from '$app/navigation';
  import type { MarketplaceAgent } from '$lib/state/marketplace.svelte';
  import { parseTags, installAgent, marketplaceState } from '$lib/state/marketplace.svelte';

  interface Props {
    agent: MarketplaceAgent;
    onInstall?: (agentId: string) => void;
  }

  let { agent, onInstall }: Props = $props();

  const tags = $derived(parseTags(agent.tags));
  const installCount = $derived(agent.installCount ?? 0);

  const avatarUrl = $derived(
    `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(agent.avatarSeed)}&backgroundColor=transparent`
  );

  function formatInstallCount(n: number): string {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  }

  async function handleInstall() {
    if (onInstall) {
      onInstall(agent.id);
    } else {
      goto(`/marketplace/agents/${agent.id}?tab=install`);
    }
  }
</script>

<div class="group relative bg-bg2 border border-border rounded-xl p-4 flex flex-col gap-3 hover:-translate-y-0.5 hover:border-brand-pink/30 hover:shadow-lg hover:shadow-black/20 transition-all duration-200">
  <!-- Clickable area (avatar + name) -->
  <a
    href="/marketplace/agents/{agent.id}"
    class="flex flex-col items-center gap-2 no-underline"
  >
    <!-- Avatar -->
    <div class="w-20 h-20 rounded-full bg-bg3 border border-border overflow-hidden flex items-center justify-center">
      <img
        src={avatarUrl}
        alt={agent.name}
        class="w-full h-full object-cover"
        loading="lazy"
      />
    </div>

    <!-- Name + Role -->
    <div class="text-center">
      <h3 class="text-sm font-bold text-foreground leading-tight">{agent.name}</h3>
      <p class="text-xs text-muted mt-0.5">{agent.role}</p>
    </div>
  </a>

  <!-- Catchphrase -->
  {#if agent.catchphrase}
    <div class="border-t border-border/50 pt-2">
      <p class="text-xs text-muted italic text-center leading-relaxed line-clamp-2">"{agent.catchphrase}"</p>
    </div>
  {/if}

  <!-- Tags -->
  {#if tags.length > 0}
    <div class="border-t border-border/50 pt-2 flex flex-wrap gap-1 justify-center">
      {#each tags.slice(0, 4) as tag (tag)}
        <span class="px-1.5 py-0.5 rounded text-[10px] bg-bg3 text-muted border border-border/50 leading-none">{tag}</span>
      {/each}
    </div>
  {/if}

  <!-- Stats row -->
  <div class="border-t border-border/50 pt-2 flex items-center justify-between text-[10px] text-muted">
    <span class="flex items-center gap-1">
      <span class="opacity-60">📥</span>
      {formatInstallCount(installCount)}
    </span>
    <span class="px-1.5 py-0.5 rounded bg-bg3 border border-border/50">{agent.category}</span>
  </div>

  <!-- Actions -->
  <div class="flex gap-2 mt-auto">
    <a
      href="/marketplace/agents/{agent.id}"
      class="flex-1 text-xs py-1.5 px-2 rounded-lg border border-border text-muted hover:text-foreground hover:bg-bg3 transition-colors duration-100 text-center no-underline"
    >
      View
    </a>
    <button
      type="button"
      onclick={handleInstall}
      class="flex-1 text-xs py-1.5 px-2 rounded-lg bg-brand-pink/10 border border-brand-pink/30 text-brand-pink hover:bg-brand-pink/20 transition-colors duration-100"
    >
      Install
    </button>
  </div>
</div>
