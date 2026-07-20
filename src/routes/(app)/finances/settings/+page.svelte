<script lang="ts">
  import type { PageData } from './$types';
  import { Settings2, RefreshCw, Plug, Coins } from 'lucide-svelte';
  import { PageHeader, Button, Select, Toggle, ProgressBar, iconSizes } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';
  import { financeSync } from '$lib/state/features/finance-sync.svelte';
  import { onMount } from 'svelte';
  import { canAct } from '$lib/access/can.svelte';
  import { fetchJson } from '$lib/api/fetch-json';

  let { data }: { data: PageData } = $props();

  // ── Connector card ────────────────────────────────────────────────────────
  // svelte-ignore state_referenced_locally
  const src = data.source;
  let businessId = $state(
    // svelte-ignore state_referenced_locally
    typeof (src?.config as Record<string, unknown> | null | undefined)?.businessId === 'number'
      ? String((src?.config as Record<string, unknown>).businessId)
      : '',
  );
  // svelte-ignore state_referenced_locally
  const hasCredentials = $state(src?.hasCredentials ?? false);
  let secretUsername = $state('');
  let secretPassword = $state('');
  let connectorEnabled = $state(
    // svelte-ignore state_referenced_locally
    src?.enabled ?? true,
  );
  let connectorBusy = $state(false);
  let connectorMsg = $state<{ ok: boolean; text: string } | null>(null);

  async function saveConnector() {
    connectorBusy = true;
    connectorMsg = null;
    try {
      const res = await fetch('/api/finances/sources', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'susii',
          config: { businessId: businessId ? Number(businessId) : null },
          username: secretUsername,
          password: secretPassword,
          enabled: connectorEnabled,
        }),
      });
      connectorMsg = res.ok
        ? { ok: true, text: m.fin_connector_saved() }
        : { ok: false, text: m.fin_connector_error() };
    } catch {
      connectorMsg = { ok: false, text: m.fin_connector_error() };
    } finally {
      connectorBusy = false;
    }
  }

  // ── Currency / Tax / Exchange-rate card ───────────────────────────────────
  // svelte-ignore state_referenced_locally
  const s0 = data.settings;
  // svelte-ignore state_referenced_locally
  let currency = $state(s0.currency);
  // Tax rate is a fraction in the DB (0.18); edited as a percent here.
  // svelte-ignore state_referenced_locally
  let taxPct = $state(String(Math.round(s0.taxRate * 10000) / 100));
  // svelte-ignore state_referenced_locally
  let fxManual = $state(s0.fxMode === 'manual');
  // svelte-ignore state_referenced_locally
  let fxManualRate = $state(s0.fxManualRate != null ? String(s0.fxManualRate) : '');
  let fxAutoRate = $state(s0.fxAutoRate);
  let fxUpdatedAt = $state(s0.fxUpdatedAt);
  let fxBase = $state(s0.fxBase);
  let fxQuote = $state(s0.fxQuote);
  let settingsBusy = $state(false);
  let fxBusy = $state(false);
  let settingsMsg = $state<{ ok: boolean; text: string } | null>(null);

  const effectiveFx = $derived(fxManual ? Number(fxManualRate) || null : fxAutoRate);

  async function saveFinSettings() {
    settingsBusy = true;
    settingsMsg = null;
    try {
      const taxRate = Number(taxPct) / 100;
      const res = await fetch('/api/finances/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          currency,
          taxRate,
          fxMode: fxManual ? 'manual' : 'auto',
          fxManualRate: fxManual && fxManualRate ? Number(fxManualRate) : null,
        }),
      });
      settingsMsg = res.ok
        ? { ok: true, text: m.fin_settings_saved() }
        : { ok: false, text: m.fin_settings_error() };
    } catch {
      settingsMsg = { ok: false, text: m.fin_settings_error() };
    } finally {
      settingsBusy = false;
    }
  }

  async function refreshFx() {
    fxBusy = true;
    settingsMsg = null;
    try {
      const { settings } = await fetchJson<{
        settings: { fxAutoRate: number | null; fxUpdatedAt: string | null };
      }>('/api/finances/settings', { method: 'POST' });
      fxAutoRate = settings.fxAutoRate;
      fxUpdatedAt = settings.fxUpdatedAt;
      settingsMsg = { ok: true, text: m.fin_fx_refreshed() };
    } catch {
      settingsMsg = { ok: false, text: m.fin_fx_error() };
    } finally {
      fxBusy = false;
    }
  }

  onMount(() => {
    financeSync.refresh('susii');
    return () => financeSync.stop();
  });

  function syncStatusLabel(): string {
    switch (financeSync.status) {
      case 'running':
      case 'queued':
        return m.fin_sync_status_running();
      case 'succeeded':
        return m.fin_sync_status_succeeded();
      case 'failed':
        return m.fin_sync_status_failed();
      case 'cancelled':
        return m.fin_sync_status_cancelled();
      default:
        return '';
    }
  }
</script>

<svelte:head><title>{m.fin_settings_title()}</title></svelte:head>

<PageShell archetype="form" scroll="region" labelledBy="finances-settings-title">
  <PageHeader
    titleId="finances-settings-title"
    title={m.fin_settings_title()}
    subtitle={m.fin_settings_subtitle()}
  >
    {#snippet leading()}
      <Settings2 size={iconSizes.md} class="text-accent shrink-0" />
    {/snippet}
  </PageHeader>

  <PageBody padding="compact" scroll="region">
    <div class="grid gap-4 max-w-2xl">
      <!-- ── Connector card ─────────────────────────────────────────────── -->
      <section class="card">
        <header class="card-h">
          <Plug size={iconSizes.sm} />
          <span>{m.fin_connector_card()}</span>
        </header>

        <div class="field">
          <span class="t-caption">{m.fin_connector_provider()}</span>
          <span class="mono-val">susii</span>
        </div>

        <label class="field">
          <span class="t-caption">{m.fin_connector_business_id()}</span>
          <input
            class="inp"
            type="number"
            min="1"
            bind:value={businessId}
            placeholder={m.fin_connector_business_id_ph()}
          />
        </label>

        {#if hasCredentials}
          <p class="t-caption cred-hint">{m.fin_connector_credentials_hint()}</p>
        {/if}

        <label class="field">
          <span class="t-caption">{m.fin_connector_secret_username()}</span>
          <input class="inp" type="text" autocomplete="username" bind:value={secretUsername} />
        </label>

        <label class="field">
          <span class="t-caption">{m.fin_connector_secret_password()}</span>
          <input
            class="inp"
            type="password"
            autocomplete="new-password"
            bind:value={secretPassword}
          />
        </label>

        <div class="field">
          <Toggle bind:checked={connectorEnabled} label={m.fin_connector_enabled()} />
        </div>

        {#if src?.lastSyncAt}
          <div class="meta-row">
            <span class="t-caption">{m.fin_connector_last_sync()}</span>
            <span class="mono-val">{new Date(src.lastSyncAt).toLocaleString()}</span>
          </div>
        {/if}
        {#if src?.lastStatus}
          <div class="meta-row">
            <span class="t-caption">{m.fin_connector_last_status()}</span>
            <span class="mono-val">{src.lastStatus}</span>
          </div>
        {/if}
        {#if src?.watermark}
          <div class="meta-row">
            <span class="t-caption">{m.fin_connector_watermark()}</span>
            <span class="mono-val">{src.watermark}</span>
          </div>
        {/if}

        {#if connectorMsg}
          <p class={connectorMsg.ok ? 'ok-msg' : 'err-msg'}>{connectorMsg.text}</p>
        {/if}

        <div class="actions">
          <Button
            variant="primary"
            size="sm"
            onclick={saveConnector}
            disabled={connectorBusy || !canAct('finance', 'edit')}
            title={canAct('finance', 'edit') ? undefined : m.no_permission()}
          >
            {m.fin_connector_save()}
          </Button>
        </div>
      </section>

      <!-- ── Currency / Tax / Exchange-rate card ────────────────────────── -->
      <section class="card">
        <header class="card-h">
          <Coins size={iconSizes.sm} />
          <span>{m.fin_money_card()}</span>
        </header>

        <Select
          fieldClass="field"
          label={m.fin_money_currency()}
          bind:value={currency}
          options={[
            { value: 'PEN', label: 'PEN — S/ (Sol)' },
            { value: 'USD', label: 'USD — $ (Dollar)' },
            { value: 'EUR', label: 'EUR — € (Euro)' },
          ]}
        />

        <label class="field">
          <span class="t-caption">{m.fin_money_tax_rate()}</span>
          <div class="pct-wrap">
            <input class="inp" type="number" min="0" max="99.99" step="0.01" bind:value={taxPct} />
            <span class="pct-suffix">%</span>
          </div>
          <span class="t-caption hint">{m.fin_money_tax_hint()}</span>
        </label>

        <div class="field">
          <span class="t-caption">{m.fin_fx_rate({ base: fxBase, quote: fxQuote })}</span>
          <div class="fx-row">
            <Toggle bind:checked={fxManual} label={m.fin_fx_manual()} />
          </div>
          {#if fxManual}
            <div class="pct-wrap mt-2">
              <span class="pct-prefix">1 {fxBase} =</span>
              <input
                class="inp"
                type="number"
                min="0"
                step="0.0001"
                bind:value={fxManualRate}
                placeholder="3.7500"
              />
              <span class="pct-suffix">{fxQuote}</span>
            </div>
          {:else}
            <div class="fx-auto mt-2">
              <span class="mono-val">
                {#if fxAutoRate != null}1 {fxBase} = {fxAutoRate}
                  {fxQuote}{:else}{m.fin_fx_none()}{/if}
              </span>
              <Button
                variant="outline"
                size="sm"
                onclick={refreshFx}
                disabled={fxBusy || !canAct('finance', 'edit')}
              >
                <RefreshCw size={13} class={fxBusy ? 'animate-spin' : ''} />
                {m.fin_fx_refresh()}
              </Button>
            </div>
            {#if fxUpdatedAt}
              <span class="t-caption hint"
                >{m.fin_fx_updated({ when: new Date(fxUpdatedAt).toLocaleString() })}</span
              >
            {/if}
          {/if}
          {#if effectiveFx != null}
            <span class="t-caption hint">{m.fin_fx_effective({ rate: String(effectiveFx) })}</span>
          {/if}
        </div>

        {#if settingsMsg}
          <p class={settingsMsg.ok ? 'ok-msg' : 'err-msg'}>{settingsMsg.text}</p>
        {/if}

        <div class="actions">
          <Button
            variant="primary"
            size="sm"
            onclick={saveFinSettings}
            disabled={settingsBusy || !canAct('finance', 'edit')}
            title={canAct('finance', 'edit') ? undefined : m.no_permission()}
          >
            {m.fin_connector_save()}
          </Button>
        </div>
      </section>

      <!-- ── Sync card ──────────────────────────────────────────────────── -->
      <section class="card">
        <header class="card-h">
          <RefreshCw size={iconSizes.sm} />
          <span>{m.fin_sync_card()}</span>
        </header>

        <p class="t-caption mb-3">{m.fin_sync_description()}</p>

        {#if financeSync.active || financeSync.status}
          <ProgressBar
            class="mb-3"
            value={financeSync.total == null ? null : financeSync.processed}
            max={financeSync.total ?? 100}
            label={syncStatusLabel()}
            detail={financeSync.total != null
              ? `${m.fin_sync_progress({
                  processed: financeSync.processed,
                  total: financeSync.total,
                })} · ${financeSync.percent}%`
              : String(financeSync.processed)}
          />
        {/if}

        {#if financeSync.status === 'failed' && financeSync.error}
          <p class="err-msg">{financeSync.error}</p>
        {/if}

        <div class="actions sync-actions">
          <Button
            variant="outline"
            size="sm"
            onclick={() => financeSync.start('susii')}
            disabled={financeSync.active || !canAct('finance', 'edit')}
            title={canAct('finance', 'edit') ? undefined : m.no_permission()}
          >
            <RefreshCw size={iconSizes.sm} class={financeSync.active ? 'animate-spin' : ''} />
            {financeSync.active ? m.fin_sync_running() : m.fin_sync_now()}
          </Button>
          {#if financeSync.active}
            <Button variant="ghost" size="sm" onclick={() => financeSync.cancel('susii')}
              >{m.fin_sync_cancel()}</Button
            >
          {/if}
        </div>
      </section>
    </div>
  </PageBody>
</PageShell>

<style>
  .card {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-card);
    padding: var(--space-3, 12px) var(--space-4, 16px);
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .card-h {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    font-size: var(--font-size-caption, 12px);
    font-weight: 600;
    color: var(--color-muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin-bottom: var(--space-3, 12px);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 4px);
    margin-bottom: var(--space-3, 12px);
  }
  .inp {
    height: 2rem;
    padding: 0 var(--space-2);
    font-size: var(--font-size-body, 14px);
    border-radius: var(--radius-md);
    background: var(--color-bg3);
    border: 1px solid var(--hairline);
  }
  .mono-val {
    font-size: var(--font-size-body, 14px);
    font-family: var(--font-mono, monospace);
    color: var(--color-muted-foreground);
  }
  .meta-row {
    display: flex;
    align-items: center;
    gap: var(--space-3, 12px);
    margin-bottom: var(--space-2, 8px);
    font-size: var(--font-size-body, 14px);
  }
  .meta-row .t-caption {
    min-width: 9rem;
  }
  .actions {
    margin-top: var(--space-3, 12px);
  }
  .ok-msg {
    font-size: var(--font-size-body, 14px);
    color: var(--color-success, var(--color-emerald));
    margin-bottom: var(--space-2, 8px);
  }
  .err-msg {
    font-size: var(--font-size-body, 14px);
    color: var(--color-destructive);
    margin-bottom: var(--space-2, 8px);
  }
  .cred-hint {
    font-size: var(--font-size-caption, 12px);
    color: var(--color-muted-foreground);
    margin-bottom: var(--space-2, 8px);
    font-style: italic;
  }
  .sync-actions {
    display: flex;
    gap: var(--space-2, 8px);
    align-items: center;
  }
  .hint {
    font-style: italic;
    margin-top: var(--space-1, 4px);
  }
  .pct-wrap {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
  }
  .pct-wrap .inp {
    flex: 1;
    min-width: 0;
  }
  .pct-prefix,
  .pct-suffix {
    font-size: var(--font-size-body, 14px);
    color: var(--color-muted-foreground);
    white-space: nowrap;
  }
  .fx-row {
    display: flex;
    align-items: center;
  }
  .fx-auto {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3, 12px);
  }
  .mt-2 {
    margin-top: var(--space-2, 8px);
  }
</style>
