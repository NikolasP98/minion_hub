<script lang="ts">
  import type { PageData } from './$types';
  import {
    BellRing,
    Check,
    X,
    MinusCircle,
    Plus,
    Trash2,
    RefreshCw,
    Sparkles,
  } from 'lucide-svelte';
  import { invalidate } from '$app/navigation';
  import { PageHeader, Card, Button, Toggle, EmptyState, Badge, Select } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import ChannelBrandIcon from '$lib/components/channels/ChannelBrandIcon.svelte';
  import * as m from '$lib/paraglide/messages';
  import { canAct } from '$lib/access/can.svelte';

  let { data }: { data: PageData } = $props();

  type Stage = {
    key: string;
    minutesBefore?: number;
    enabled: boolean;
    recipients: 'client' | 'team' | 'both';
  };
  type Chan = { channel: string; accountId: string | null };

  function seedStages(): Stage[] {
    const raw = (data.config?.stages as Array<Record<string, unknown>>) ?? [];
    return raw.map((s) => ({
      key: String(s.key),
      minutesBefore: s.minutesBefore != null ? Number(s.minutesBefore) : undefined,
      enabled: s.enabled !== false,
      recipients: (s.recipients as Stage['recipients']) ?? 'client',
    }));
  }
  function seedChannels(): Chan[] {
    const raw = (data.config?.channels as Chan[] | null) ?? [];
    if (raw.length) return raw.map((c) => ({ channel: c.channel, accountId: c.accountId ?? null }));
    // Back-compat: hoist the legacy single channel/account into the array.
    if (data.config?.accountId || data.config?.channel)
      return [
        { channel: data.config?.channel || 'whatsapp', accountId: data.config?.accountId ?? null },
      ];
    return [];
  }

  // svelte-ignore state_referenced_locally
  let enabled = $state(data.config?.enabled ?? false);
  // svelte-ignore state_referenced_locally
  let personalize = $state(data.config?.personalize ?? true);
  // svelte-ignore state_referenced_locally
  let inferConfirmation = $state(data.config?.inferConfirmation ?? false);
  // svelte-ignore state_referenced_locally
  let fromName = $state(data.config?.fromName ?? '');
  // svelte-ignore state_referenced_locally
  let stages = $state<Stage[]>(seedStages());
  // svelte-ignore state_referenced_locally
  let channels = $state<Chan[]>(seedChannels());
  let saving = $state(false);

  // Dirty tracking — Save only appears when something changed.
  const snapshot = (e: boolean, p: boolean, inf: boolean, f: string, st: Stage[], ch: Chan[]) =>
    JSON.stringify({ e, p, inf, f: f.trim(), st, ch });
  // svelte-ignore state_referenced_locally
  const original = snapshot(enabled, personalize, inferConfirmation, fromName, stages, channels);
  const dirty = $derived(
    snapshot(enabled, personalize, inferConfirmation, fromName, stages, channels) !== original,
  );

  const counts = $derived(data.activity?.counts ?? { sent: 0, failed: 0, skipped: 0 });
  const recent = $derived(data.activity?.recent ?? []);
  const catalog = $derived(data.channels ?? []);

  const STAGE_LABEL: Record<string, () => string> = {
    confirmation: () => m.sched_rem_stage_confirmation(),
    '24h': () => m.sched_rem_stage_24h(),
    '2h': () => m.sched_rem_stage_2h(),
  };
  const stageLabel = (k: string) => (STAGE_LABEL[k] ?? (() => k))();

  function chanKey(c: { channel: string; accountId: string | null }) {
    return `${c.channel}:${c.accountId ?? ''}`;
  }
  function chanSelected(c: { channel: string; accountId: string | null }) {
    return channels.some((x) => chanKey(x) === chanKey(c));
  }
  function toggleChannel(c: { channel: string; accountId: string | null }) {
    const k = chanKey(c);
    channels = chanSelected(c)
      ? channels.filter((x) => chanKey(x) !== k)
      : [...channels, { channel: c.channel, accountId: c.accountId }];
  }

  function addStage() {
    stages = [
      ...stages,
      { key: `t${Date.now()}`, minutesBefore: 60, enabled: true, recipients: 'client' },
    ];
  }
  function removeStage(i: number) {
    stages = stages.filter((_, idx) => idx !== i);
  }

  function fmt(iso: string): string {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  // ── AI preview ──────────────────────────────────────────────────────────
  let previewText = $state('');
  let previewLoading = $state(false);
  async function regenerate() {
    previewLoading = true;
    try {
      const res = await fetch('/api/scheduling/reminders/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          stage: 'confirmation',
          personalize: true,
          fromName: fromName || null,
        }),
      });
      previewText = res.ok ? ((await res.json()).text ?? '') : '';
    } catch {
      previewText = '';
    } finally {
      previewLoading = false;
    }
  }
  $effect(() => {
    // Fetch a first preview when AI personalization is turned on and none shown.
    if (personalize && !previewText && !previewLoading) void regenerate();
  });

  async function save() {
    saving = true;
    try {
      const res = await fetch('/api/scheduling/reminders/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled,
          personalize,
          inferConfirmation,
          fromName: fromName || null,
          stages,
          channels,
        }),
      });
      if (res.ok) await invalidate('scheduling:data');
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head><title>{m.sched_rem_title()} · {m.nav_scheduling()}</title></svelte:head>

<PageShell
  archetype="form"
  scroll="region"
  labelledBy="scheduling-reminders-title"
  class="scheduling-reminders-surface"
>
  <PageHeader
    titleId="scheduling-reminders-title"
    title={m.sched_rem_title()}
    subtitle={m.sched_rem_subtitle()}
  >
    {#snippet leading()}
      <BellRing size={16} class="text-accent shrink-0" />
    {/snippet}
    {#snippet actions()}
      {#if dirty}
        <Button
          size="sm"
          onclick={save}
          disabled={saving || !canAct('scheduling', 'edit')}
          title={canAct('scheduling', 'edit') ? undefined : m.no_permission()}
          >{m.sched_rem_save()}</Button
        >
      {/if}
    {/snippet}
  </PageHeader>

  <PageBody padding="compact" scroll="region" class="flex flex-col gap-4 max-w-3xl">
    <!-- Enable -->
    <Card padding="lg">
      <p class="text-sm text-[var(--color-muted-foreground)]">{m.sched_rem_autonomy()}</p>
      <div
        class="mt-4 flex items-center justify-between gap-4 pt-3 border-t border-[var(--hairline)]"
      >
        <div>
          <div class="font-medium">{m.sched_rem_enabled()}</div>
          <div class="t-caption">{m.sched_rem_enabled_desc()}</div>
        </div>
        <Toggle bind:checked={enabled} size="md" ariaLabel={m.sched_rem_enabled()} />
      </div>
      {#if enabled && channels.length === 0}
        <p class="t-caption mt-2" style="color:var(--color-destructive)">
          {m.sched_rem_needs_account()}
        </p>
      {/if}
    </Card>

    <!-- Channels -->
    <Card padding="lg">
      <div class="t-label">{m.sched_rem_channels()}</div>
      <p class="t-caption mb-2">{m.sched_rem_channels_help()}</p>
      {#if catalog.length === 0}
        <p class="t-caption">{m.sched_rem_no_channels()}</p>
      {:else}
        <div class="flex flex-wrap gap-2">
          {#each catalog as c (chanKey(c))}
            <Button
              variant="ghost"
              size="sm"
              type="button"
              class="chip {chanSelected(c) ? 'chip-on' : ''}"
              onclick={() => toggleChannel(c)}
              title={`${c.channel} · ${c.name ?? c.phone ?? c.accountId}`}
            >
              <ChannelBrandIcon channel={c.channel} size={16} />
              <span class="opacity-80">{c.name ?? c.phone ?? c.accountId}</span>
            </Button>
          {/each}
        </div>
      {/if}
    </Card>

    <!-- When notifications fire -->
    <Card padding="lg">
      <div class="t-label mb-2">{m.sched_rem_stages()}</div>
      <div class="flex flex-col gap-2">
        {#each stages as s, i (s.key)}
          <div class="stage {s.enabled ? '' : 'stage-off'}">
            <Toggle bind:checked={s.enabled} size="sm" ariaLabel={stageLabel(s.key)} />
            <div class="stage-main">
              <div class="font-medium text-sm">{stageLabel(s.key)}</div>
              {#if s.minutesBefore != null}
                <div class="flex items-center gap-1">
                  <input class="num" type="number" min="0" bind:value={s.minutesBefore} />
                  <span class="t-caption">{m.sched_rem_minutes_before()}</span>
                </div>
              {:else}
                <div class="t-caption">{m.sched_rem_confirmation_note()}</div>
              {/if}
            </div>
            <label class="recip">
              <span class="t-caption">{m.sched_rem_recipient()}</span>
              <Select class="num" bind:value={s.recipients}>
                <option value="client">{m.sched_rem_recipient_client()}</option>
                <option value="team">{m.sched_rem_recipient_team()}</option>
                <option value="both">{m.sched_rem_recipient_both()}</option>
              </Select>
            </label>
            {#if s.key !== 'confirmation'}
              <Button
                variant="ghost"
                size="sm"
                class="icon-btn"
                onclick={() => removeStage(i)}
                title={m.sched_rem_remove()}><Trash2 size={15} /></Button
              >
            {/if}
          </div>
        {/each}
      </div>
      <Button variant="ghost" size="sm" class="add" onclick={addStage}
        ><Plus size={14} /> {m.sched_rem_add_stage()}</Button
      >
    </Card>

    <!-- Confirmations -->
    <Card padding="lg">
      <div class="t-label">{m.sched_rem_confirm_title()}</div>
      <div class="mt-2 flex items-center justify-between gap-4">
        <div>
          <div class="font-medium text-sm flex items-center gap-1">
            <Sparkles size={14} class="text-accent" />
            {m.sched_rem_infer()}
          </div>
          <div class="t-caption">
            {inferConfirmation ? m.sched_rem_infer_on() : m.sched_rem_infer_off()}
          </div>
        </div>
        <Toggle bind:checked={inferConfirmation} size="sm" ariaLabel={m.sched_rem_infer()} />
      </div>
    </Card>

    <!-- Message + personalization -->
    <Card padding="lg">
      <label class="field max-w-xs">
        <span class="t-caption">{m.sched_rem_fromName()}</span>
        <input class="txt" bind:value={fromName} placeholder="FACES" />
        <span class="t-caption">{m.sched_rem_fromName_help()}</span>
      </label>
      <div class="mt-4 flex items-center justify-between gap-4">
        <div>
          <div class="font-medium text-sm flex items-center gap-1">
            <Sparkles size={14} class="text-accent" />
            {m.sched_rem_personalize()}
          </div>
          <div class="t-caption">{m.sched_rem_personalize_desc()}</div>
        </div>
        <Toggle bind:checked={personalize} size="sm" ariaLabel={m.sched_rem_personalize()} />
      </div>
      {#if personalize}
        <div class="preview mt-3">
          <div class="flex items-center justify-between mb-1">
            <span class="t-caption">{m.sched_rem_preview()}</span>
            <Button
              variant="ghost"
              size="sm"
              class="icon-btn"
              onclick={regenerate}
              disabled={previewLoading}
              title={m.sched_rem_regenerate()}
            >
              <RefreshCw size={14} class={previewLoading ? 'spin' : ''} />
              {m.sched_rem_regenerate()}
            </Button>
          </div>
          <p class="preview-text">{previewLoading && !previewText ? '…' : previewText || '—'}</p>
        </div>
      {/if}
    </Card>

    <!-- Status + activity -->
    <Card padding="lg">
      <div class="flex items-center gap-4 mb-3">
        <div class="t-label">{m.sched_rem_activity()}</div>
        <span class="t-caption">· {m.sched_rem_stat_window()}</span>
        <div class="flex-1"></div>
        <span class="stat"><Check size={13} /> {counts.sent}</span>
        <span class="stat"><X size={13} /> {counts.failed}</span>
        <span class="stat"><MinusCircle size={13} /> {counts.skipped}</span>
      </div>
      {#if recent.length === 0}
        <EmptyState title={m.sched_rem_empty_activity()} compact />
      {:else}
        <div class="flex flex-col">
          {#each recent as r (r.id)}
            <div class="row">
              <span class="row-stage">{stageLabel(r.stage)}</span>
              <span class="flex-1 truncate">{r.serviceTitle ?? '—'}</span>
              <span class="t-caption truncate">{r.recipient ?? ''}</span>
              <Badge>{r.status}</Badge>
              <span class="t-caption">{fmt(r.createdAt)}</span>
            </div>
          {/each}
        </div>
      {/if}
    </Card>
  </PageBody>
</PageShell>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 4px);
  }
  .txt {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    padding: var(--space-2, 8px) var(--space-2, 8px);
    background: var(--color-card);
    font-size: var(--font-size-body, 14px);
    width: 100%;
  }
  .num {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    padding: var(--space-1, 4px) var(--space-2, 8px);
    background: var(--color-card);
    font-size: var(--font-size-body, 14px);
    width: 5.5rem;
  }
  .stage {
    display: flex;
    align-items: center;
    gap: var(--space-3, 12px);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    padding: var(--space-2, 8px) var(--space-3, 12px);
  }
  .stage-off {
    opacity: 0.55;
  }
  .stage-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 4px);
  }
  .recip {
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 4px);
  }
  .preview {
    border: 1px dashed var(--hairline);
    border-radius: var(--radius-lg);
    padding: var(--space-2, 8px) var(--space-3, 12px);
    background: color-mix(in srgb, var(--color-accent) 6%, transparent);
  }
  .preview-text {
    font-size: var(--font-size-body, 14px);
    line-height: 1.4;
  }
  :global(.spin) {
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .stat {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1, 4px);
    font-size: var(--font-size-body, 14px);
    color: var(--color-muted-foreground);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    padding: var(--space-2, 8px) 0;
    border-bottom: 1px solid var(--hairline);
    font-size: var(--font-size-body, 14px);
  }
  .row:last-child {
    border-bottom: none;
  }
  .row-stage {
    min-width: 150px;
    font-weight: 500;
  }
</style>
