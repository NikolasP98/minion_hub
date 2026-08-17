<script lang="ts">
  import { invalidate } from '$lib/navigation';
  import { Button, Input } from '$lib/components/ui';
  import Dialog from '$lib/components/ui/foundations/Dialog.svelte';
  import { fetchJson } from '$lib/api/fetch-json';
  import * as m from '$lib/paraglide/messages';

  interface Purchase {
    id: string;
    supplierRuc: string | null;
    supplierName: string | null;
    docType: string | null;
    serie: string | null;
    numero: string | null;
    issuedAt: string | null;
    currency: string | null;
    baseGravada: string | null;
    igv: string | null;
    total: string | null;
  }

  let {
    open = $bindable(false),
    period,
    purchase = null,
    onclose,
  }: {
    open?: boolean;
    period: string;
    purchase?: Purchase | null;
    onclose?: () => void;
  } = $props();

  function close() {
    open = false;
    onclose?.();
  }

  const isEdit = $derived(purchase != null);

  let supplierRuc = $state('');
  let supplierName = $state('');
  let docType = $state('');
  let serie = $state('');
  let numero = $state('');
  let issuedAt = $state('');
  let baseGravada = $state('');
  let igv = $state('');
  let total = $state('');
  let submitError = $state('');
  let saving = $state(false);

  // Reseed editable fields from the prop whenever the dialog opens for a
  // (possibly different) row — a plain effect, not $derived, so user edits
  // mid-session survive re-renders (same pattern as BrainCreateDialog).
  $effect(() => {
    if (!open) return;
    supplierRuc = purchase?.supplierRuc ?? '';
    supplierName = purchase?.supplierName ?? '';
    docType = purchase?.docType ?? '';
    serie = purchase?.serie ?? '';
    numero = purchase?.numero ?? '';
    issuedAt = purchase?.issuedAt ?? '';
    baseGravada = purchase?.baseGravada ?? '';
    igv = purchase?.igv ?? '';
    total = purchase?.total ?? '';
    submitError = '';
  });

  const canSubmit = $derived(supplierName.trim().length > 0 || serie.trim().length > 0);

  function num(v: string): number | null {
    const n = Number(v.trim());
    return v.trim() === '' || !Number.isFinite(n) ? null : n;
  }

  async function submit() {
    if (!canSubmit || saving) return;
    saving = true;
    submitError = '';
    const payload = {
      supplierRuc: supplierRuc.trim() || null,
      supplierName: supplierName.trim() || null,
      docType: docType.trim() || null,
      serie: serie.trim() || null,
      numero: numero.trim() || null,
      issuedAt: issuedAt.trim() || null,
      baseGravada: num(baseGravada),
      igv: num(igv),
      total: num(total),
    };
    try {
      if (isEdit && purchase) {
        await fetchJson(`/api/finances/purchases/${purchase.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await fetchJson('/api/finances/purchases', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...payload, period }),
        });
      }
      await invalidate('finances:purchases');
      close();
    } catch (e) {
      submitError = e instanceof Error ? e.message : m.common_error();
    } finally {
      saving = false;
    }
  }
</script>

<Dialog
  bind:open
  title={isEdit ? m.fin_purchases_edit_title() : m.fin_purchases_add_title()}
  size="md"
  onclose={() => onclose?.()}
>
  <div class="purchase-form">
    <div class="identity-fields">
      <Input
        id="pur-ruc"
        label={m.fin_purchases_field_ruc()}
        bind:value={supplierRuc}
        maxlength="20"
        autocomplete="off"
      />
      <Input
        id="pur-name"
        label={m.fin_purchases_field_supplier()}
        bind:value={supplierName}
        autocomplete="off"
      />
    </div>
    <div class="doc-fields">
      <Input
        id="pur-doctype"
        label={m.fin_purchases_field_doctype()}
        bind:value={docType}
        maxlength="10"
        autocomplete="off"
      />
      <Input
        id="pur-serie"
        label={m.fin_purchases_field_serie()}
        bind:value={serie}
        maxlength="20"
        autocomplete="off"
      />
      <Input
        id="pur-numero"
        label={m.fin_purchases_field_numero()}
        bind:value={numero}
        maxlength="20"
        autocomplete="off"
      />
    </div>
    <Input
      id="pur-issued"
      label={m.fin_purchases_field_date()}
      type="text"
      placeholder="YYYY-MM-DD"
      bind:value={issuedAt}
      autocomplete="off"
    />
    <div class="amount-fields">
      <Input
        id="pur-base"
        label={m.fin_purchases_field_base()}
        type="number"
        bind:value={baseGravada}
        autocomplete="off"
      />
      <Input
        id="pur-igv"
        label={m.fin_purchases_field_igv()}
        type="number"
        bind:value={igv}
        autocomplete="off"
      />
      <Input
        id="pur-total"
        label={m.fin_purchases_field_total()}
        type="number"
        bind:value={total}
        autocomplete="off"
      />
    </div>

    {#if submitError}
      <p class="form-error" role="alert">{submitError}</p>
    {/if}
  </div>

  {#snippet footer()}
    <Button variant="ghost" size="sm" disabled={saving} onclick={close}>
      {m.common_cancel()}
    </Button>
    <Button
      variant="primary"
      size="sm"
      disabled={!canSubmit || saving}
      loading={saving}
      onclick={submit}
    >
      {isEdit ? m.common_save() : m.fin_purchases_add_title()}
    </Button>
  {/snippet}
</Dialog>

<style>
  .purchase-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .identity-fields {
    display: grid;
    grid-template-columns: minmax(0, 0.4fr) minmax(0, 1fr);
    gap: var(--space-3);
  }
  .doc-fields {
    display: grid;
    grid-template-columns: minmax(0, 0.5fr) minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--space-3);
  }
  .amount-fields {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
  }
  .form-error {
    color: var(--color-danger-fg);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
  }
  @media (max-width: 767.98px) {
    .identity-fields,
    .doc-fields,
    .amount-fields {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
