<script lang="ts">
  import { MessageCircle } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { Button, iconSizes } from '$lib/components/ui';
  import type { DoorPublicProps } from '$lib/doors/types';
  import { faqJsonLd, type FaqPublicData } from '$lib/doors/kinds/faq';

  let { data }: DoorPublicProps = $props();

  const faq = $derived(data as unknown as FaqPublicData);
  const entries = $derived(faq.entries ?? []);
  const waHref = $derived(
    faq.whatsappNumber ? `https://wa.me/${faq.whatsappNumber.replace(/\D/g, '')}` : null,
  );
  // faqJsonLd escapes `<`, so no answer can close the script tag.
  const jsonLd = $derived(`<script type="application/ld+json">${faqJsonLd(entries)}</` + `script>`);
</script>

<svelte:head>
  {#if entries.length > 0}
    <!-- escaped by faqJsonLd; approved entries only -->
    {@html jsonLd}
  {/if}
</svelte:head>

<div class="faq">
  {#if entries.length === 0}
    <p class="t-body muted">{m.doors_faq_public_empty()}</p>
  {:else}
    {#each entries as entry, i (i)}
      <details class="entry">
        <summary class="t-label">{entry.q}</summary>
        <p class="t-body answer">{entry.a}</p>
      </details>
    {/each}
  {/if}
  {#if waHref}
    <Button href={waHref} target="_blank" rel="noopener" variant="primary">
      {#snippet icon()}<MessageCircle size={iconSizes.md} />{/snippet}
      {m.doors_faq_whatsapp_cta()}
    </Button>
  {/if}
</div>

<style>
  .faq {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .entry {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    padding: var(--space-2) var(--space-3);
  }
  .entry summary {
    cursor: pointer;
    color: var(--color-text-primary);
  }
  .answer {
    margin: var(--space-2) 0 0;
    color: var(--color-text-secondary);
    white-space: pre-line;
  }
  .muted {
    color: var(--color-text-secondary);
  }
</style>
