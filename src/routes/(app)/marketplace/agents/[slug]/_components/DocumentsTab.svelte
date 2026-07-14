<script lang="ts">
  import type { MarketplaceAgent } from '$lib/state/features/marketplace.svelte';
  import * as m from '$lib/paraglide/messages';
  import { Button } from '$lib/components/ui';

  type DocTab = 'soul' | 'identity' | 'context' | 'skills';

  interface Props {
    agent: MarketplaceAgent;
  }

  let { agent }: Props = $props();

  let activeDocTab = $state<DocTab>('soul');

  const docTabs: {
    id: DocTab;
    label: string;
    field: keyof MarketplaceAgent;
  }[] = [
    { id: 'soul', label: 'SOUL', field: 'soulMd' },
    { id: 'identity', label: 'IDENTITY', field: 'identityMd' },
    { id: 'context', label: 'CONTEXT', field: 'contextMd' },
    { id: 'skills', label: 'SKILLS', field: 'skillsMd' },
  ];

  // Simple markdown renderer
  function renderMd(md: string | null | undefined): string {
    if (!md)
      return `<p class="text-muted text-xs italic">${m.marketplace_agentDetailNoContent()}</p>`;
    return md
      .replace(
        /^#{3}\s+(.+)$/gm,
        '<h3 class="text-sm font-semibold text-foreground mt-4 mb-1">$1</h3>',
      )
      .replace(
        /^#{2}\s+(.+)$/gm,
        '<h2 class="text-base font-bold text-foreground mt-5 mb-2">$1</h2>',
      )
      .replace(/^#{1}\s+(.+)$/gm, '<h1 class="text-lg font-bold text-foreground mt-6 mb-2">$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong class="text-foreground font-semibold">$1</strong>')
      .replace(/\*(.+?)\*/g, '<em class="text-muted italic">$1</em>')
      .replace(
        /`(.+?)`/g,
        '<code class="px-1 py-0.5 rounded bg-bg3 text-brand-pink text-xs font-mono">$1</code>',
      )
      .replace(
        /^[-*]\s+(.+)$/gm,
        '<li class="ml-4 text-xs text-foreground/80 list-disc list-outside">$1</li>',
      )
      .replace(/(<li.*<\/li>)/gs, '<ul class="my-2 space-y-1">$1</ul>')
      .replace(/\n{2,}/g, '</p><p class="text-xs text-foreground/80 leading-relaxed mb-2">')
      .replace(/^(?!<[hulo])(.+)$/gm, '$1')
      .replace(/^(.+(?!\n))$/gm, (line) => {
        if (line.startsWith('<')) return line;
        return `<p class="text-xs text-foreground/80 leading-relaxed mb-2">${line}</p>`;
      });
  }
</script>

<div class="documents-section">
  <!-- Doc Tabs -->
  <div class="doc-tabs">
    {#each docTabs as dt}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onclick={() => {
          activeDocTab = dt.id;
        }}
        class="doc-tab {activeDocTab === dt.id ? 'active' : ''}"
      >
        {dt.label}
      </Button>
    {/each}
  </div>

  <!-- Doc Content -->
  <div class="doc-content">
    {#each docTabs as dt}
      {#if activeDocTab === dt.id}
        <div class="markdown-content">
          {@html renderMd(agent[dt.field] as string | null)}
        </div>
      {/if}
    {/each}
  </div>
</div>

<style>
  .documents-section {
    background: var(--elevation-2-bg);
    border: 1px solid var(--elevation-2-border);
    border-radius: var(--radius-xl);
    overflow: hidden;
  }

  .doc-tabs {
    display: flex;
    gap: var(--space-0-5);
    padding: var(--space-2);
    background: var(--color-bg);
    border-bottom: 1px solid var(--hairline);
  }

  :global(.doc-tab) {
    flex: 1;
    padding: var(--space-2);
    background: transparent;
    border: none;
    border-radius: var(--radius-lg);
    color: var(--color-muted-foreground);
    font-size: var(--font-size-caption, 12px);
    font-weight: 600;
    font-family: 'JetBrains Mono NF', monospace;
    cursor: pointer;
    transition: all var(--duration-normal) var(--ease-standard);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  :global(.doc-tab:hover) {
    color: var(--color-foreground);
    background: var(--elevation-3-bg);
  }

  :global(.doc-tab.active) {
    background: color-mix(in srgb, var(--color-brand-pink) 15%, transparent);
    color: var(--color-brand-pink);
  }

  .doc-content {
    padding: var(--space-page-section);
    min-height: 300px;
  }

  .markdown-content :global(p) {
    font-size: var(--font-size-body, 14px);
    line-height: 1.7;
    color: var(--color-muted);
    margin-bottom: var(--space-3);
  }

  .markdown-content :global(h1),
  .markdown-content :global(h2),
  .markdown-content :global(h3) {
    color: var(--color-foreground);
    margin-top: var(--space-card);
    margin-bottom: var(--space-2);
  }

  .markdown-content :global(ul) {
    margin: var(--space-3) 0;
    padding-left: var(--space-card);
  }

  .markdown-content :global(li) {
    font-size: var(--font-size-body, 14px);
    color: var(--color-muted);
    margin-bottom: var(--space-2);
  }

  .markdown-content :global(code) {
    background: color-mix(in srgb, var(--color-brand-pink) 10%, transparent);
    color: var(--color-brand-pink);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-caption, 12px);
  }
</style>
