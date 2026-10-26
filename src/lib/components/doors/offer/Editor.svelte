<script lang="ts">
  import { onMount } from 'svelte';
  import { ListFilter, X } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import {
    Badge,
    Button,
    Input,
    Picker,
    Select,
    iconSizes,
    type PickerColumn,
  } from '$lib/components/ui';
  import { FormField } from '$lib/components/ui/foundations';
  import type { DoorEditorProps } from '$lib/doors/types';
  import { defaultConfig, type OfferConfig } from '$lib/doors/kinds/offer';

  let { config, onchange, canManage }: DoorEditorProps = $props();

  interface Sellable {
    productId: string;
    name: string;
    category: string | null;
    unitPrice: number | null;
  }
  interface Link {
    id: string;
    title: string;
    active: boolean;
  }

  const cfg = $derived({ ...defaultConfig, ...(config as Partial<OfferConfig>) } as OfferConfig);
  const patch = (p: Partial<OfferConfig>) => onchange({ ...cfg, ...p });

  let sellables = $state<Sellable[]>([]);
  let links = $state<Link[]>([]);
  let loadFailed = $state(false);
  let open = $state(false);

  onMount(async () => {
    try {
      const [s, l] = await Promise.all([
        fetch('/api/pos/sellables'),
        fetch('/api/scheduling/links'),
      ]);
      if (s.ok) sellables = (await s.json()).sellables ?? [];
      else loadFailed = true;
      // Scheduling may be off or unreadable for this role: the booking select just stays empty.
      if (l.ok) links = ((await l.json()).links ?? []) as Link[];
    } catch {
      loadFailed = true;
    }
  });

  const selected = $derived(cfg.productIds.map((id) => sellables.find((s) => s.productId === id)));
  const bookingOptions = $derived([
    { value: '', label: m.doors_offer_booking_none() },
    ...links.map((l) => ({
      value: l.id,
      label: l.active ? l.title : `${l.title} (${m.doors_offer_link_off()})`,
    })),
  ]);
  const pickedIds = $derived(new Set(cfg.productIds));
  const columns: PickerColumn<Sellable>[] = [
    {
      key: 'name',
      label: m.doors_offer_item(),
      priority: 10,
      emphasis: 'primary',
      hideable: false,
      searchable: true,
    },
    {
      key: 'category',
      label: m.doors_offer_category(),
      value: (r) => r.category ?? '',
      priority: 20,
      searchable: true,
    },
    {
      key: 'unitPrice',
      label: m.doors_offer_price(),
      value: (r) => (r.unitPrice == null ? '' : String(r.unitPrice)),
      priority: 30,
    },
  ];
</script>

<div class="offer-editor">
  <div role="group" aria-labelledby="offer-items-label" class="items">
    <span id="offer-items-label" class="t-label">{m.doors_offer_items()}</span>
    <div class="chips">
      {#each cfg.productIds as id, i (id)}
        <Badge size="sm">
          {selected[i]?.name ?? m.doors_offer_unavailable()}
          {#if canManage}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              shape="icon"
              aria-label={m.common_remove()}
              onclick={() => patch({ productIds: cfg.productIds.filter((x) => x !== id) })}
            >
              <X size={iconSizes.xs} aria-hidden="true" />
            </Button>
          {/if}
        </Badge>
      {/each}
      {#if canManage}
        <Button type="button" variant="outline" size="sm" onclick={() => (open = true)}>
          <ListFilter size={iconSizes.sm} aria-hidden="true" />
          {m.doors_offer_pick()}
        </Button>
      {/if}
    </div>
    {#if loadFailed}<p class="t-caption muted">{m.doors_offer_load_error()}</p>{/if}
  </div>

  <FormField
    label={m.doors_offer_whatsapp()}
    helper={m.doors_offer_whatsapp_hint()}
    disabled={!canManage}
  >
    {#snippet children(p)}
      <Input
        {...p}
        value={cfg.whatsappNumber ?? ''}
        placeholder="+51 900 000 000"
        maxlength={30}
        oninput={(e: Event) =>
          patch({ whatsappNumber: (e.currentTarget as HTMLInputElement).value.trim() || null })}
      />
    {/snippet}
  </FormField>

  <Select
    label={m.doors_offer_booking()}
    helper={m.doors_offer_booking_hint()}
    disabled={!canManage}
    value={cfg.bookingLinkId ?? ''}
    options={bookingOptions}
    onchange={(v) => patch({ bookingLinkId: String(v) || null })}
  />
</div>

<Picker
  bind:open
  title={m.doors_offer_pick()}
  {columns}
  rows={sellables}
  getRowId={(r) => r.productId}
  {pickedIds}
  selectionMode="multiple"
  duplicatePolicy="prevent"
  onPick={(r) =>
    !pickedIds.has(r.productId) && patch({ productIds: [...cfg.productIds, r.productId] })}
  onUnpick={(r) => patch({ productIds: cfg.productIds.filter((x) => x !== r.productId) })}
  storageKey="doors-offer-picker"
/>

<style>
  .offer-editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .items {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    align-items: center;
  }
  .muted {
    color: var(--color-text-secondary);
  }
</style>
