<script lang="ts">
  import { tick } from 'svelte';
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
  import { inPeek, peekSaveStatus } from '$lib/records/peek.svelte';
  import { createSaveStatus } from '$lib/records/save-status.svelte';
  import SaveIndicator from '$lib/records/SaveIndicator.svelte';

  let {
    stockEnabled,
    stockItems,
    consumption,
    categories,
    takenCodes,
    tags = [],
    inheritedTags = [],
    editing = null,
  }: {
    stockEnabled: boolean;
    stockItems: StockItemLike[];
    consumption: ConsumptionLike[];
    categories: string[];
    takenCodes: string[];
    tags?: CalTag[];
    /** Stock tags inherited from the product's ingredients (read-only). */
    inheritedTags?: CalTag[];
    editing?: SellableLike | null;
  } = $props();

  const isEditing = $derived(editing !== null);
  // One save-status per open record: reuse the peek's shared indicator when
  // embedded, otherwise own one (bare-page render, e.g. deep link/expand).
  const saveStatus = peekSaveStatus() ?? createSaveStatus();
  let attachmentsRefreshKey = $state(0);

  function returnToCatalog() {
    return goto('/pos/catalog');
  }

  const kindLabel = (k: SellableLike['kind']) =>
    k === 'service'
      ? m.pos_catalog_kind_service()
      : k === 'bundle'
        ? m.pos_catalog_kind_bundle()
        : m.pos_catalog_kind_product();

  // ── Inline-editable title (Notion: the title IS the name) ────────────────
  // Seeded once from the prop, then owns its own display value so a save can
  // update it without waiting on a full reload (same pattern as other
  // "seed once from a prop" form state in this repo — see hub CLAUDE.md).
  // svelte-ignore state_referenced_locally
  let displayName = $state(editing?.name ?? '');
  // Starts unsynced on purpose — the $effect below runs once immediately on
  // mount and seeds it from `editing`, so no local-prop-read here either.
  let syncedProductId = $state<string | null>(null);
  $effect(() => {
    if (editing && editing.productId !== syncedProductId) {
      displayName = editing.name;
      syncedProductId = editing.productId;
    }
  });

  const title = $derived(isEditing ? displayName : m.pos_catalog_new());
  const subtitle = $derived(
    editing ? `${editing.code} · ${kindLabel(editing.kind)}` : m.pos_catalog_new_subtitle(),
  );

  let titleEditing = $state(false);
  let titleDraft = $state('');
  let titleInputEl = $state<HTMLInputElement | null>(null);

  function startTitleEdit() {
    if (!editing || titleEditing) return;
    titleDraft = displayName;
    titleEditing = true;
    void tick().then(() => titleInputEl?.focus());
  }
  function cancelTitleEdit() {
    titleEditing = false;
  }
  async function commitTitleEdit() {
    if (!editing) return;
    titleEditing = false;
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === displayName) return;
    const productId = editing.productId;
    displayName = trimmed;
    try {
      await saveStatus.run(() => saveName(productId, trimmed));
    } catch {
      // saveStatus surfaces the error + Retry — the typed value stays visible.
    }
  }
  async function saveName(productId: string, value: string): Promise<void> {
    const res = await fetch(`/api/pos/sellables/${productId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: value }),
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(d.error ?? `Failed (${res.status})`);
    }
  }
  function onTitleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void commitTitleEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelTitleEdit();
    }
  }
</script>

<svelte:head><title>{title} — {m.pos_nav_catalog()}</title></svelte:head>

{#snippet editableTitle(headingId: string)}
  {#if titleEditing}
    <input
      bind:this={titleInputEl}
      bind:value={titleDraft}
      id={headingId}
      class="t-heading title-input"
      onblur={commitTitleEdit}
      onkeydown={onTitleKeydown}
      aria-label={m.stock_field_name()}
    />
  {:else}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <h1
      id={headingId}
      class="t-heading title-edit"
      tabindex="0"
      onclick={startTitleEdit}
      onfocus={startTitleEdit}
      onkeydown={(e: KeyboardEvent) => {
        if (e.key === 'Enter') startTitleEdit();
      }}
    >
      {displayName}
    </h1>
  {/if}
{/snippet}

<PageShell archetype="form" scroll="region" labelledBy="pos-catalog-editor-title">
  <PageHeader
    titleId="pos-catalog-editor-title"
    {title}
    {subtitle}
    titleContent={isEditing ? editableTitle : undefined}
  >
    {#snippet leading()}
      {#if isEditing}
        <Pencil size={iconSizes.md} class="text-accent shrink-0" aria-hidden="true" />
      {:else}
        <PackagePlus size={iconSizes.md} class="text-accent shrink-0" aria-hidden="true" />
      {/if}
    {/snippet}
    {#snippet actions()}
      {#if !inPeek()}
        <SaveIndicator
          status={saveStatus.status}
          message={saveStatus.message}
          onRetry={() => saveStatus.retry()}
        />
        <Button variant="outline" size="sm" onclick={returnToCatalog}>
          <ArrowLeft size={iconSizes.sm} aria-hidden="true" />
          {m.pos_catalog_title()}
        </Button>
      {/if}
    {/snippet}
  </PageHeader>

  <PageBody width="reading" scroll="region">
    {#if editing}
      <!-- Edit mode: flat, full-width sections — no Card box (owner: "box
           within a box"), no Save/Cancel (autosave on blur/change). -->
      <SellableWizard
        presentation="page"
        open
        {stockEnabled}
        {stockItems}
        {consumption}
        {categories}
        {takenCodes}
        allTags={tags}
        {inheritedTags}
        {editing}
        {saveStatus}
        onCancel={returnToCatalog}
        onSaved={returnToCatalog}
      />
      <section class="attach-section">
        <header class="attach-h">
          <span>{m.attachments_title()}</span>
          <AttachmentButton
            objectType="product"
            objectId={editing.productId}
            size="sm"
            variant="ghost"
            hint="tooltip"
            class="card-action"
            disabled={!canAct('pos', 'edit')}
            onuploaded={() => (attachmentsRefreshKey += 1)}
          />
        </header>
        <AttachmentList
          objectType="product"
          objectId={editing.productId}
          refreshKey={attachmentsRefreshKey}
        />
      </section>
    {:else}
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
          {inheritedTags}
          editing={null}
          {saveStatus}
          onCancel={returnToCatalog}
          onSaved={returnToCatalog}
        />
      </Card>
    {/if}
  </PageBody>
</PageShell>

<style>
  .title-edit {
    cursor: text;
    border-radius: var(--radius-sm);
  }
  .title-input {
    width: 100%;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    padding: 0;
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
  }
  .title-input:focus-visible {
    box-shadow: var(--shadow-focus);
  }

  .attach-section {
    padding-block: var(--space-section);
    border-top: 1px solid var(--hairline);
  }
  .attach-h {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
    font-size: var(--font-size-caption);
    font-weight: 600;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .attach-h :global(.card-action) {
    height: auto;
    min-height: 0;
    padding: 0;
    border: 0;
    font-size: var(--font-size-caption);
    font-weight: inherit;
    line-height: inherit;
    text-transform: inherit;
    letter-spacing: inherit;
    color: var(--color-accent);
  }
  .attach-h :global(.card-action > span) {
    height: auto;
    min-height: 0;
    gap: var(--space-1);
  }
</style>
