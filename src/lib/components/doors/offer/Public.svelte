<script lang="ts">
  import { MessageCircle, CalendarCheck } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { formatMoney } from '$lib/utils/format';
  import { Button, iconSizes } from '$lib/components/ui';
  import type { DoorPublicProps } from '$lib/doors/types';

  let { door, data }: DoorPublicProps = $props();

  interface Item {
    name: string;
    category: string | null;
    price: number | null;
  }
  const items = $derived((data.items as Item[]) ?? []);
  const currency = $derived(String(data.currency ?? 'PEN'));
  const waUrl = $derived((data.waUrl as string | null) ?? null);
  // Seeded/kind-like categories are translated; free-text categories show as typed.
  const categoryLabel = (c: string) =>
    c === 'service'
      ? m.pos_catalog_kind_service()
      : c === 'product'
        ? m.pos_catalog_kind_product()
        : c;
  const bookingSlug = $derived((data.bookingSlug as string | null) ?? null);

  const ask = (name: string) =>
    `${waUrl}?text=${encodeURIComponent(m.doors_offer_wa_text({ name }))}`;

  // TODO(handoff): online payment link (Culqi / Mercado Pago) — no credentials yet; see proposal 2026-10-24-hub-collection-points-followups
</script>

{#if items.length === 0}
  <p class="t-body muted">{m.doors_offer_empty()}</p>
{:else}
  <ul class="offer-list" aria-label={door.title}>
    {#each items as item, i (i)}
      <li class="offer-card">
        <div class="offer-main">
          <span class="t-body-strong">{item.name}</span>
          {#if item.category}<span class="t-caption muted">{categoryLabel(item.category)}</span
            >{/if}
        </div>
        {#if item.price != null}<span class="t-body-strong offer-price"
            >{formatMoney(item.price, currency)}</span
          >{/if}
        {#if waUrl}
          <Button
            href={ask(item.name)}
            target="_blank"
            rel="noopener noreferrer"
            variant="outline"
            size="sm"
          >
            <MessageCircle size={iconSizes.sm} aria-hidden="true" />
            {m.doors_offer_ask_whatsapp()}
          </Button>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

{#if bookingSlug}
  <div class="offer-book">
    <Button href={`/book/${bookingSlug}`}>
      <CalendarCheck size={iconSizes.sm} aria-hidden="true" />
      {m.doors_offer_book()}
    </Button>
  </div>
{/if}

<style>
  .offer-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-3);
  }
  .offer-card {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-card);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
  }
  .offer-main {
    display: grid;
    flex: 1 1 12rem;
    min-width: 0;
  }
  .offer-price {
    white-space: nowrap;
  }
  .offer-book {
    margin-top: var(--space-4);
  }
  .muted {
    color: var(--color-text-secondary);
  }
</style>
