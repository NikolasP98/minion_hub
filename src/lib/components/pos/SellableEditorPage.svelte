<script lang="ts">
  import { goto } from '$app/navigation';
  import { ArrowLeft, PackagePlus, Pencil } from 'lucide-svelte';
  import { Button, Card, PageHeader, iconSizes } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';
  import SellableWizard, {
    type ConsumptionLike,
    type SellableLike,
    type StockItemLike,
  } from './SellableWizard.svelte';
  import type { CalTag } from '$lib/components/scheduling/calendar/types';
  import { AttachmentButton, AttachmentList } from '$lib/components/attachments';
  import { canAct } from '$lib/access/can.svelte';

  let {
    stockEnabled,
    stockItems,
    consumption,
    categories,
    takenCodes,
    tags = [],
    editing = null,
  }: {
    stockEnabled: boolean;
    stockItems: StockItemLike[];
    consumption: ConsumptionLike[];
    categories: string[];
    takenCodes: string[];
    tags?: CalTag[];
    editing?: SellableLike | null;
  } = $props();

  const isEditing = $derived(editing !== null);
  const title = $derived(isEditing ? m.pos_catalog_edit() : m.pos_catalog_new());
  const subtitle = $derived(
    isEditing ? m.pos_catalog_edit_subtitle() : m.pos_catalog_new_subtitle(),
  );
  let attachmentsRefreshKey = $state(0);

  function returnToCatalog() {
    return goto('/pos/catalog');
  }
</script>

<svelte:head><title>{title} — {m.pos_nav_catalog()}</title></svelte:head>

<PageShell archetype="form" scroll="region" labelledBy="pos-catalog-editor-title">
  <PageHeader titleId="pos-catalog-editor-title" {title} {subtitle}>
    {#snippet leading()}
      {#if isEditing}
        <Pencil size={iconSizes.md} class="text-accent shrink-0" aria-hidden="true" />
      {:else}
        <PackagePlus size={iconSizes.md} class="text-accent shrink-0" aria-hidden="true" />
      {/if}
    {/snippet}
    {#snippet actions()}
      <Button variant="outline" size="sm" onclick={returnToCatalog}>
        <ArrowLeft size={iconSizes.sm} aria-hidden="true" />
        {m.pos_catalog_title()}
      </Button>
    {/snippet}
  </PageHeader>

  <PageBody width="reading" scroll="region">
    <Card padding="lg">
      <SellableWizard
        presentation="page"
        open
        {stockEnabled}
        {stockItems}
        {consumption}
        {categories}
        {takenCodes}
        allTags={tags}
        {editing}
        onCancel={returnToCatalog}
        onSaved={returnToCatalog}
      />
    </Card>

    {#if editing}
      <Card padding="lg">
        <div class="flex items-center justify-between gap-2 mb-2">
          <span class="t-caption">{m.attachments_title()}</span>
          <AttachmentButton
            objectType="product"
            objectId={editing.productId}
            size="sm"
            disabled={!canAct('pos', 'edit')}
            onuploaded={() => (attachmentsRefreshKey += 1)}
          />
        </div>
        <AttachmentList
          objectType="product"
          objectId={editing.productId}
          refreshKey={attachmentsRefreshKey}
        />
      </Card>
    {/if}
  </PageBody>
</PageShell>
