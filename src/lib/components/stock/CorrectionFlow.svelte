<script lang="ts" module>
  export type CorrectionPreviewView = {
    eligible: boolean;
    blockers: string[];
    previewHash: string;
    payloadHash: string;
    quantityEffects: { itemId: string; before: string; after: string }[];
    cost: {
      lines: { lineId: string; kind: 'qty' | 'rate'; before: string; after: string }[];
    } | null;
  };
</script>

<script lang="ts">
  /**
   * Preview -> reason -> confirm for one stock correction (spec 124). The host supplies the request
   * bodies; this keeps one operation key per approved intent, saves its recovery pointer BEFORE the
   * write, and after a lost answer only asks the server what happened (never repeats the write).
   */
  import { untrack } from 'svelte';
  import { Button } from '$lib/components/ui';
  import { FormField } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';
  import { correctionRefusal } from './correction-refusals';
  import { lockReason } from './lock-reasons';
  import type { LockHit } from '$lib/types/record-locks';
  import {
    clearRefusedPendingCorrection,
    dismissAppliedPendingCorrection,
    persistPendingCorrection,
    readPendingCorrections,
    type PendingCorrectionScope,
    type PendingCorrectionV1,
    type PendingStatus,
  } from './correction-pending';

  type PendingView = {
    value: PendingCorrectionV1;
    state: 'checking' | 'unknown' | 'unavailable' | 'applied';
    status?: PendingStatus;
  };
  interface Props {
    scope: PendingCorrectionScope;
    previewUrl: string;
    applyUrl: string;
    /** Known-key status lookup (the same for every host). */
    statusUrl?: string;
    /** The request to preview for this reason, or null while the host's input is incomplete/unchanged. */
    previewBody: (reason: string) => unknown | null;
    applyBody: (a: {
      reason: string;
      operationKey: string;
      previewHash: string;
      payloadHash: string;
    }) => unknown;
    itemLabel?: (itemId: string) => string | undefined;
    lineLabel?: (lineId: string) => string | undefined;
    /** Host-specific wording for a refusal code; falls back to the shared closed list. */
    refusal?: (code: string) => string | undefined;
    /** Show the "values hidden" note when a stock-moving preview carries no cost. */
    costExpected?: boolean;
    disabled?: boolean;
    /** `recovered` = learned from a status lookup (reload/lost answer), not from this mount's own POST. */
    onapplied: (source: 'post' | 'recovered') => void | Promise<void>;
    onrefused?: (code: string) => void;
  }
  let {
    scope,
    previewUrl,
    applyUrl,
    statusUrl = '/api/stock/corrections',
    previewBody,
    applyBody,
    itemLabel,
    lineLabel,
    refusal,
    costExpected = false,
    disabled = false,
    onapplied,
    onrefused,
  }: Props = $props();

  let reason = $state('');
  let preview = $state<CorrectionPreviewView | null>(null);
  let previewedIntent = $state('');
  let busy = $state(false);
  let err = $state<string | null>(null);
  let done = $state(false);
  let pending = $state<PendingView[]>([]);
  let storageBlocked = $state(false);
  let op: { key: string; payloadHash: string } | null = null;
  const sent = new Set<string>();
  let generation = 0;

  // A lock refusal names every rule that applies (spec 140), then the next step.
  const message = (code: string | undefined, locks?: unknown) => {
    const hits = Array.isArray(locks) ? (locks as LockHit[]) : [];
    // A closed current month cannot be unlocked per record: only reopening the month helps, never "ask an owner".
    const stuck = hits.some((h) => !h.unlockable);
    const base =
      (code ? refusal?.(stuck ? 'period_locked' : code) : undefined) ??
      correctionRefusal(stuck ? 'period_locked' : code);
    return hits.length ? `${hits.map(lockReason).join('. ')}. ${base}` : base;
  };
  const intent = $derived(JSON.stringify(previewBody(reason.trim())));
  const hasIntent = $derived(previewBody(reason.trim()) !== null && reason.trim().length > 0);
  const stale = $derived(preview !== null && previewedIntent !== intent);
  const blocked = $derived(pending.some((p) => p.state !== 'applied'));

  async function checkStatus(view: PendingView, gen: number) {
    const set = (next: Partial<PendingView>) => {
      if (gen !== generation) return;
      pending = pending.map((p) =>
        p.value.operationKey === view.value.operationKey &&
        p.value.payloadHash === view.value.payloadHash
          ? { ...p, ...next }
          : p,
      );
    };
    set({ state: 'checking' });
    try {
      const q = new URLSearchParams({
        operationKey: view.value.operationKey,
        payloadHash: view.value.payloadHash,
      });
      const res = await fetch(`${statusUrl}?${q}`, { cache: 'no-store' });
      if (gen !== generation) return;
      if (!res.ok) return set({ state: 'unavailable' });
      const body = (await res.json()) as PendingStatus;
      const applied =
        body.outcome === 'applied' &&
        body.receipt?.operationKey === view.value.operationKey &&
        body.receipt?.sourceId === view.value.sourceId;
      if (applied) {
        set({ state: 'applied', status: body });
        await onapplied('recovered');
      } else set({ state: 'unknown' });
    } catch {
      set({ state: 'unavailable' });
    }
  }

  /** Scope change (org/profile/source): drop everything shown, ignore late answers, re-read this scope's pointers. */
  function load() {
    generation += 1;
    const gen = generation;
    preview = null;
    previewedIntent = '';
    err = null;
    done = false;
    op = null;
    storageBlocked = false;
    try {
      pending = readPendingCorrections(localStorage, scope).map((value) => ({
        value,
        state: 'checking' as const,
      }));
    } catch {
      pending = [];
      storageBlocked = true;
      return;
    }
    for (const p of pending) void checkStatus(p, gen);
  }
  $effect(() => {
    // The scope fields are the only dependencies; the rest of load() must not re-run it.
    void [scope.orgId, scope.profileId, scope.sourceType, scope.sourceId];
    untrack(load);
  });

  async function runPreview() {
    if (!hasIntent || busy || blocked || disabled) return;
    const gen = generation;
    busy = true;
    err = null;
    done = false;
    const body = previewBody(reason.trim());
    const asked = intent;
    try {
      const res = await fetch(previewUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (gen !== generation) return;
      const out = (await res.json().catch(() => ({}))) as CorrectionPreviewView & {
        code?: string;
        locks?: unknown;
      };
      if (!res.ok) {
        preview = null;
        err = message(out.code, out.locks);
        return;
      }
      preview = out;
      previewedIntent = asked;
      // One key per approved intent: a re-review of the same payload keeps it.
      if (out.payloadHash && op?.payloadHash !== out.payloadHash)
        op = { key: crypto.randomUUID(), payloadHash: out.payloadHash };
    } catch {
      if (gen === generation) err = m.stock_corr_err_generic();
    } finally {
      if (gen === generation) busy = false;
    }
  }

  async function confirm() {
    if (!preview?.eligible || stale || busy || blocked || disabled || !op) return;
    const gen = generation;
    const value: PendingCorrectionV1 = {
      schemaVersion: 1,
      ...scope,
      operationKey: op.key,
      previewHash: preview.previewHash,
      payloadHash: preview.payloadHash,
    };
    const id = `${value.operationKey}:${value.payloadHash}`;
    if (sent.has(id)) return;
    try {
      persistPendingCorrection(localStorage, value); // zero POST when this fails
    } catch {
      err = m.stock_corr_storage();
      return;
    }
    sent.add(id);
    busy = true;
    err = null;
    const unknown = () => {
      pending = [{ value, state: 'checking' }];
      void checkStatus(pending[0], gen);
    };
    try {
      let res: Response;
      try {
        res = await fetch(applyUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            applyBody({
              reason: reason.trim(),
              operationKey: value.operationKey,
              previewHash: value.previewHash,
              payloadHash: value.payloadHash,
            }),
          ),
        });
      } catch {
        if (gen === generation) unknown();
        return;
      }
      if (gen !== generation) return; // another scope is shown now; the pointer stays for this principal
      const body = (await res.json().catch(() => null)) as
        (PendingStatus & { code?: string; locks?: unknown }) | null;
      if (
        res.ok &&
        body?.outcome === 'applied' &&
        body.receipt?.operationKey === value.operationKey
      ) {
        try {
          dismissAppliedPendingCorrection(localStorage, value, body);
        } catch {
          /* the pointer stays and can be dismissed later */
        }
        done = true;
        preview = null;
        reason = '';
        await onapplied('post');
      } else if (!res.ok && body?.outcome === 'not_applied' && typeof body.code === 'string') {
        // A typed refusal of THIS live request: nothing was written, so the pointer can go.
        clearRefusedPendingCorrection(localStorage, value);
        sent.delete(id);
        preview = null;
        err = message(body.code, body.locks);
        onrefused?.(body.code);
      } else unknown(); // 5xx, malformed or unrecognised: the outcome is unknown, never "failed"
    } finally {
      if (gen === generation) busy = false;
    }
  }

  function dismiss(view: PendingView) {
    if (!view.status) return;
    try {
      dismissAppliedPendingCorrection(localStorage, view.value, view.status);
      pending = pending.filter((p) => p !== view);
    } catch {
      /* the pointer stays; nothing else to do */
    }
  }
  const ref = (v: PendingCorrectionV1) => v.operationKey.slice(0, 8);
  const copyRef = (v: PendingCorrectionV1) => void navigator.clipboard?.writeText(v.operationKey);
</script>

<svelte:window
  onstorage={(e) => {
    if (e.key === null || e.key.startsWith('minion:stock-correction:pending:v1:')) untrack(load);
  }}
/>

<div class="corr">
  {#each pending as p (p.value.operationKey + p.value.payloadHash)}
    <section class="corr-box" role="status">
      {#if p.state === 'applied'}
        <p class="t-caption">{m.stock_corr_applied_check()}</p>
        <div class="corr-row">
          <Button variant="outline" size="xs" type="button" onclick={() => dismiss(p)}
            >{m.common_dismiss()}</Button
          >
        </div>
      {:else}
        <p class="t-label">{m.stock_corr_pending_title()}</p>
        <p class="t-caption">
          {p.state === 'unknown'
            ? m.stock_corr_unknown({ ref: ref(p.value) })
            : p.state === 'unavailable'
              ? m.stock_corr_check_failed()
              : m.stock_corr_pending_body()}
        </p>
        <div class="corr-row">
          <Button
            variant="outline"
            size="xs"
            type="button"
            disabled={p.state === 'checking'}
            loading={p.state === 'checking'}
            onclick={() => void checkStatus(p, generation)}>{m.stock_corr_check()}</Button
          >
          <Button variant="ghost" size="xs" type="button" onclick={() => copyRef(p.value)}
            >{m.stock_corr_copy_ref()}</Button
          >
          <span class="t-caption">{m.stock_corr_ref({ ref: ref(p.value) })}</span>
        </div>
      {/if}
    </section>
  {/each}

  {#if storageBlocked}
    <p class="t-caption corr-err">{m.stock_corr_storage()}</p>
  {:else if !blocked}
    <FormField label={m.stock_corr_reason_label()} helper={m.stock_corr_reason_hint()} required>
      {#snippet children(control)}
        <textarea {...control} bind:value={reason} rows="2" maxlength="1000"></textarea>
      {/snippet}
    </FormField>
    <div class="corr-row">
      <Button
        type="button"
        variant="outline"
        loading={busy && preview === null}
        disabled={busy || !hasIntent || disabled}
        onclick={runPreview}>{m.stock_corr_preview()}</Button
      >
    </div>

    {#if preview}
      <section class="corr-box" aria-label={m.stock_corr_effects_title()}>
        <p class="t-label">{m.stock_corr_effects_title()}</p>
        {#if preview.quantityEffects.length === 0}
          <p class="t-caption">{m.stock_corr_effects_none()}</p>
        {:else if itemLabel}
          <ul class="corr-list">
            {#each preview.quantityEffects as e (e.itemId)}
              <li class="t-caption">
                {m.stock_corr_effect_row({
                  item: itemLabel(e.itemId) ?? e.itemId,
                  before: e.before,
                  after: e.after,
                })}
              </li>
            {/each}
          </ul>
        {:else}
          <p class="t-caption">
            {m.stock_corr_effects_count({ count: preview.quantityEffects.length })}
          </p>
        {/if}
        {#if preview.cost}
          <p class="t-label">{m.stock_corr_cost_title()}</p>
          <ul class="corr-list">
            {#each preview.cost.lines as l (l.lineId + l.kind)}
              <li class="t-caption">
                {(l.kind === 'qty' ? m.stock_corr_cost_qty : m.stock_corr_cost_rate)({
                  item: lineLabel?.(l.lineId) ?? l.lineId,
                  before: l.before,
                  after: l.after,
                })}
              </li>
            {/each}
          </ul>
        {:else if costExpected}
          <p class="t-caption">{m.stock_corr_cost_hidden()}</p>
        {/if}
        {#if !preview.eligible}
          <p class="t-label corr-err">{m.stock_corr_blocked_title()}</p>
          {#each preview.blockers as code (code)}
            <p class="t-caption corr-err">{message(code)}</p>
          {/each}
        {/if}
      </section>
    {/if}
    {#if stale}<p class="t-caption">{m.stock_corr_stale()}</p>{/if}
    {#if done}<p class="t-caption" role="status">{m.stock_corr_applied()}</p>{/if}
    {#if err}<p class="t-caption corr-err" role="alert">{err}</p>{/if}
    {#if preview}
      <div class="corr-row">
        <Button
          type="button"
          variant="primary"
          loading={busy && preview !== null}
          disabled={busy || !preview.eligible || stale || disabled}
          onclick={confirm}>{m.stock_corr_confirm()}</Button
        >
      </div>
    {/if}
  {/if}
</div>

<style>
  .corr {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .corr-box {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
  }
  .corr-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .corr-list {
    margin: 0;
    padding-left: var(--space-4);
  }
  .corr-err {
    color: var(--color-danger-fg);
  }
  .corr textarea {
    width: 100%;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: var(--color-canvas);
    color: var(--color-foreground);
    font-size: var(--font-size-body);
  }
</style>
