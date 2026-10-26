<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { iconSizes, Button } from '$lib/components/ui';
  import { formatMoney } from '$lib/utils/format';
  import { Sparkles } from 'lucide-svelte';

  type Offer = {
    productId: string;
    name: string;
    unitPrice: number | null;
    coBuyers: number;
  };
  type Result = {
    bought: { productId: string; name: string }[];
    suggestions: Offer[];
    topSellers: Offer[];
  };
  let { contactId }: { contactId: string } = $props();

  let loading = $state(false);
  let result = $state<Result | null>(null);
  let failure = $state<string | null>(null);

  async function find() {
    if (loading) return;
    loading = true;
    failure = null;
    try {
      const r = await fetch(`/api/crm/contacts/${contactId}/next-offers`);
      if (r.ok) result = (await r.json()) as Result;
      else failure = r.status === 403 ? m.crm_offers_forbidden() : m.crm_offers_error();
    } catch {
      failure = m.crm_offers_error();
    } finally {
      loading = false;
    }
  }
</script>

{#snippet offerList(list: Offer[], withCoBuyers: boolean)}
  <ul class="offers">
    {#each list as o (o.productId)}
      <li class="offer">
        <span class="offer-name">{o.name}</span>
        <span class="offer-meta t-caption">
          {#if withCoBuyers && o.coBuyers > 0}{m.crm_offers_co_buyers({ count: o.coBuyers })} ·
          {/if}{formatMoney(o.unitPrice)}
        </span>
      </li>
    {/each}
  </ul>
{/snippet}

<section class="card">
  <header class="card-h">
    <span class="flex items-center gap-1.5"
      ><Sparkles size={iconSizes.sm} /> {m.crm_offers_title()}</span
    >
  </header>
  {#if result === null}
    <Button variant="outline" size="sm" onclick={find} disabled={loading} {loading}>
      <Sparkles size={iconSizes.sm} />
      {loading ? m.crm_offers_finding() : m.crm_offers_find()}
    </Button>
    {#if failure}<p class="t-caption" role="alert">{failure}</p>{/if}
  {:else}
    {#if result.bought.length}
      <h4 class="sub">{m.crm_offers_bought()}</h4>
      <div class="bought">
        {#each result.bought as b (b.productId)}<span class="chip">{b.name}</span>{/each}
      </div>
    {/if}
    {#if result.suggestions.length}
      <h4 class="sub">{m.crm_offers_suggested()}</h4>
      {@render offerList(result.suggestions, true)}
    {:else if result.topSellers.length}
      <h4 class="sub">{m.crm_offers_top()}</h4>
      {@render offerList(result.topSellers, false)}
    {:else}
      <p class="t-caption">{m.crm_offers_none()}</p>
    {/if}
  {/if}
</section>

<style>
  .card {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-card);
    padding: var(--space-3) var(--space-4);
  }
  .card-h {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: var(--font-size-caption);
    font-weight: 600;
    color: var(--color-muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin-bottom: var(--space-2);
  }
  .sub {
    font-size: var(--font-size-caption);
    color: var(--color-muted-foreground);
    margin: var(--space-2) 0 var(--space-1);
  }
  .bought {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .chip {
    font-size: var(--font-size-caption);
    padding: var(--space-0) var(--space-2);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    color: var(--color-accent);
  }
  .offers {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .offer {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .offer-name {
    font-weight: 600;
  }
  .offer-meta {
    color: var(--color-muted-foreground);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
</style>
