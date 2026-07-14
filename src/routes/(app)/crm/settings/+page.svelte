<script lang="ts">
  import type { PageData } from './$types';
  import { invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import {
    Plus,
    Trash2,
    Tag as TagIcon,
    Tags,
    Radio,
    Settings2,
    Pause,
    Play,
    Check,
    Wand2,
    Sparkles,
  } from 'lucide-svelte';
  import { PageHeader, Button, Select } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import ChannelBrandIcon from '$lib/components/channels/ChannelBrandIcon.svelte';
  import CrmHygiene from '$lib/components/crm/CrmHygiene.svelte';
  import { CRM_TAG_COLORS } from '$lib/components/crm/tag-colors';
  import { formatPhoneLike, relativeTime } from '$lib/components/crm/crm-format';

  type Ledger = {
    channel: string;
    accountId: string;
    contacts: number;
    lastActive: string | null;
    name?: string | null;
    phone?: string | null;
  };
  type Managed = Ledger & { label: string | null; paused: boolean };
  type Scope = { added: Managed[]; available: Ledger[]; legacy: boolean };

  let { data }: { data: PageData } = $props();
  const tags = $derived(data.tags);
  // `data.scope` is STREAMED (a promise) so the page never blocks on the gateway
  // RPC behind the account manager; it's unwrapped via {#await} in the Channels
  // tab, where `added`/`available`/`groupedAvailable` are derived locally.

  // Active tab is URL-driven (`?tab=`) so the CRM sidebar and the legacy
  // /crm/cleanup redirect can deep-link straight to a section. The load doesn't
  // read `url`, so switching tabs changes only the query string — no refetch.
  type Tab = 'tags' | 'channels' | 'hygiene';
  const tab = $derived<Tab>(
    ((t) => (t === 'channels' || t === 'hygiene' ? t : 'tags'))(page.url.searchParams.get('tab')),
  );

  // ── Tag manager ──────────────────────────────────────────────────────────
  // Auto-tag rule fields (must match RULE_FIELDS in crm-scoring.ts).
  const FIELDS = [
    { v: 'score', label: () => m.crm_field_score() },
    { v: 'last_days', label: () => m.crm_field_last_days() },
    { v: 'total_msgs', label: () => m.crm_field_total_msgs() },
    { v: 'inbound_msgs', label: () => m.crm_field_inbound_msgs() },
    { v: 'channels_used', label: () => m.crm_field_channels_used() },
    { v: 'reciprocity', label: () => m.crm_field_reciprocity() },
    { v: 'stage', label: () => m.crm_field_stage() },
  ];
  const OPS = ['>=', '>', '=', '<=', '<', '!='];
  let name = $state('');
  let color = $state<string>(CRM_TAG_COLORS[0]);
  let kind = $state<'manual' | 'auto' | 'ai'>('manual');
  let field = $state('score');
  let op = $state('>=');
  let value = $state('80');
  let description = $state('');
  let busy = $state(false);
  let err = $state('');

  function ruleValue(): number | string {
    // stage is a string field; everything else numeric.
    return field === 'stage' ? value : Number(value);
  }

  async function createTag() {
    if (!name.trim()) return;
    if (kind === 'ai' && !description.trim()) {
      err = m.crm_ai_desc_required();
      return;
    }
    busy = true;
    err = '';
    try {
      const body: Record<string, unknown> = { name: name.trim(), color, kind };
      if (kind === 'auto') body.rule = { field, op, value: ruleValue() };
      if (kind === 'ai') body.description = description.trim();
      const res = await fetch('/api/crm/tags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        name = '';
        description = '';
        await invalidate('crm:tags');
      } else {
        const j = await res.json().catch(() => ({}));
        err = j.message ?? 'Error';
      }
    } finally {
      busy = false;
    }
  }

  async function deleteTag(id: string) {
    await fetch(`/api/crm/tags/${id}`, { method: 'DELETE' });
    await invalidate('crm:tags');
  }

  // ── AI-tag evaluation ("Find matches") ──────────────────────────────────
  let evaluating = $state<string | null>(null);
  let evalResult = $state<Record<string, string>>({});
  function aiDescription(rule: unknown): string {
    if (
      rule &&
      typeof rule === 'object' &&
      typeof (rule as { description?: unknown }).description === 'string'
    ) {
      return (rule as { description: string }).description;
    }
    return '';
  }
  async function evaluateTag(id: string) {
    evaluating = id;
    try {
      const res = await fetch(`/api/crm/tags/${id}/evaluate`, { method: 'POST' });
      if (res.ok) {
        const r = await res.json();
        evalResult = {
          ...evalResult,
          [id]: m.crm_ai_eval_result({ applied: r.applied ?? 0, evaluated: r.evaluated ?? 0 }),
        };
        await invalidate('crm:contacts');
      } else {
        const j = await res.json().catch(() => ({}));
        evalResult = { ...evalResult, [id]: j.message ?? 'Error' };
      }
    } finally {
      evaluating = null;
    }
  }

  function ruleSummary(rule: unknown): string {
    if (!rule || typeof rule !== 'object') return '';
    const r = rule as { field?: string; op?: string; value?: unknown };
    if (!r.field) return '';
    return `${r.field} ${r.op} ${r.value}`;
  }

  // ── Account manager ──────────────────────────────────────────────────────
  const keyOf = (a: { channel: string; accountId: string }) => `${a.channel} ${a.accountId}`;

  let addOpen = $state(false);
  let menuKey = $state<string | null>(null);
  let renameKey = $state<string | null>(null);
  let renameValue = $state('');
  let busyKey = $state<string | null>(null);

  function channelLabel(ch: string): string {
    return ch.charAt(0).toUpperCase() + ch.slice(1);
  }
  function accountName(a: {
    accountId: string;
    label?: string | null;
    name?: string | null;
    phone?: string | null;
  }): string {
    if (a.label && a.label.trim()) return a.label; // user-set CRM label wins
    if (a.name && a.name.trim()) return a.name; // canonical gateway account name
    if (a.phone && a.phone.trim()) return formatPhoneLike(a.phone);
    if (!a.accountId || a.accountId === 'default') return m.crm_account_default();
    return formatPhoneLike(a.accountId);
  }

  // Group a list under its channel ("1 of 2 WhatsApp numbers" mental model).
  function groupByChannel<T extends { channel: string }>(list: T[]) {
    const map = new Map<string, T[]>();
    for (const a of list) {
      const arr = map.get(a.channel) ?? [];
      arr.push(a);
      map.set(a.channel, arr);
    }
    return [...map.entries()].map(([channel, items]) => ({ channel, items }));
  }

  async function addAccount(a: Ledger) {
    busyKey = keyOf(a);
    try {
      const res = await fetch('/api/crm/accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel: a.channel, accountId: a.accountId }),
      });
      if (res.ok) await invalidate('crm:accounts');
    } finally {
      busyKey = null;
      addOpen = false;
    }
  }

  async function patchAccount(a: Managed, patch: { label?: string | null; paused?: boolean }) {
    busyKey = keyOf(a);
    try {
      const res = await fetch('/api/crm/accounts', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel: a.channel, accountId: a.accountId, ...patch }),
      });
      if (res.ok) await invalidate('crm:accounts');
    } finally {
      busyKey = null;
    }
  }

  async function removeAccount(a: Managed) {
    busyKey = keyOf(a);
    menuKey = null;
    try {
      const q = new URLSearchParams({ channel: a.channel, accountId: a.accountId });
      const res = await fetch(`/api/crm/accounts?${q}`, { method: 'DELETE' });
      if (res.ok) await invalidate('crm:accounts');
    } finally {
      busyKey = null;
    }
  }

  function startRename(a: Managed) {
    renameKey = keyOf(a);
    renameValue = a.label ?? '';
  }
  async function saveRename(a: Managed) {
    await patchAccount(a, { label: renameValue.trim() || null });
    renameKey = null;
    menuKey = null;
  }
  async function togglePause(a: Managed) {
    menuKey = null;
    await patchAccount(a, { paused: !a.paused });
  }
</script>

<svelte:head><title>{m.crm_settings_title()} — {m.crm_title()}</title></svelte:head>

<PageShell
  archetype="form"
  scroll="region"
  labelledBy="crm-settings-title"
  class="crm-settings-surface"
>
  <PageHeader
    titleId="crm-settings-title"
    title={m.crm_settings_title()}
    subtitle={m.crm_settings_subtitle()}
  >
    {#snippet leading()}
      <Settings2 size={16} class="text-accent shrink-0" />
    {/snippet}
  </PageHeader>

  <!-- Tabs (URL-driven, deep-linkable) -->
  <div class="flex items-center gap-1 px-4 pt-3 border-b border-[var(--hairline)]">
    <a class="tab" class:active={tab === 'tags'} href="/crm/settings?tab=tags">
      <Tags size={14} />
      {m.crm_tab_tags()}
    </a>
    <a class="tab" class:active={tab === 'channels'} href="/crm/settings?tab=channels">
      <Radio size={14} />
      {m.crm_tab_channels()}
    </a>
    <a class="tab" class:active={tab === 'hygiene'} href="/crm/settings?tab=hygiene">
      <Wand2 size={14} />
      {m.crm_tab_hygiene()}
    </a>
  </div>

  <PageBody padding="compact" scroll="region">
    {#if tab === 'tags'}
      <div class="grid gap-4 lg:grid-cols-[1fr_1.2fr] max-w-4xl">
        <!-- Create -->
        <section class="card">
          <header class="card-h"><span>{m.crm_new_tag()}</span></header>
          <label class="field">
            <span class="t-caption">{m.crm_tag_name()}</span>
            <input bind:value={name} class="inp" placeholder={m.crm_tag_name()} />
          </label>

          <label class="field">
            <span class="t-caption">{m.crm_tag_color()}</span>
            <div class="swatches">
              {#each CRM_TAG_COLORS as c (c)}
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  class={`swatch ${color === c ? 'sel' : ''}`}
                  aria-pressed={color === c}
                  style={`background: ${c}`}
                  onclick={() => (color = c)}
                  aria-label={c}
                ></Button>
              {/each}
            </div>
          </label>

          <label class="field">
            <span class="t-caption">{m.crm_tag_type()}</span>
            <Select bind:value={kind} class="inp">
              <option value="manual">{m.crm_tag_kind_manual()}</option>
              <option value="auto">{m.crm_tag_kind_auto()}</option>
              <option value="ai">{m.crm_tag_kind_ai()}</option>
            </Select>
          </label>

          {#if kind === 'auto'}
            <div class="rule">
              <span class="t-caption">{m.crm_auto_rule()}</span>
              <div class="rule-row">
                <Select bind:value={field} class="inp">
                  {#each FIELDS as f (f.v)}<option value={f.v}>{f.label()}</option>{/each}
                </Select>
                <Select bind:value={op} class="inp w-16">
                  {#each OPS as o (o)}<option value={o}>{o}</option>{/each}
                </Select>
                <input bind:value class="inp w-24" placeholder={m.crm_rule_value()} />
              </div>
            </div>
          {:else if kind === 'ai'}
            <label class="field rule ai-rule">
              <span class="t-caption ai-head"><Sparkles size={12} /> {m.crm_ai_criteria()}</span>
              <textarea
                bind:value={description}
                class="inp ta"
                rows="3"
                placeholder={m.crm_ai_criteria_ph()}></textarea>
              <span class="ai-hint">{m.crm_ai_criteria_hint()}</span>
            </label>
          {/if}

          {#if err}<p class="err">{err}</p>{/if}
          <Button variant="primary" size="sm" onclick={createTag} disabled={busy || !name.trim()}>
            <Plus size={14} />
            {m.crm_create()}
          </Button>
        </section>

        <!-- List -->
        <section class="card">
          <header class="card-h"><span>{m.crm_manage_tags()}</span></header>
          {#if tags.length === 0}
            <p class="t-caption">{m.crm_no_tags()}</p>
          {:else}
            <ul class="taglist">
              {#each tags as t (t.id)}
                <li class:ai-row={t.kind === 'ai'}>
                  <span class="chip" style:--c={t.color ?? 'var(--color-accent)'}>
                    {#if t.kind === 'ai'}<Sparkles size={11} />{:else}<TagIcon
                        size={11}
                      />{/if}{t.name}
                  </span>
                  {#if t.kind === 'auto'}
                    <span class="auto">{m.crm_auto_badge()}: {ruleSummary(t.rule)}</span>
                  {:else if t.kind === 'ai'}
                    <span class="ai-desc" title={aiDescription(t.rule)}
                      >{aiDescription(t.rule)}</span
                    >
                    <Button
                      variant="ghost"
                      size="sm"
                      class="find"
                      onclick={() => evaluateTag(t.id)}
                      disabled={evaluating === t.id}
                    >
                      <Sparkles size={12} class={evaluating === t.id ? 'animate-pulse' : ''} />
                      {evaluating === t.id ? m.crm_ai_finding() : m.crm_ai_find_matches()}
                    </Button>
                    {#if evalResult[t.id]}<span class="ai-result">{evalResult[t.id]}</span>{/if}
                  {/if}
                  <Button
                    variant="ghost"
                    size="sm"
                    class="del"
                    onclick={() => deleteTag(t.id)}
                    aria-label={m.crm_delete()}><Trash2 size={13} /></Button
                  >
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      </div>
    {:else if tab === 'channels'}
      {#await data.scope}
        <section class="card max-w-2xl">
          <div class="card-h flush">{m.crm_channels_title()}</div>
          <p class="t-caption mt-1">{m.crm_channels_subtitle()}</p>
          <ul class="acclist" aria-busy="true">
            <li class="accrow skel"></li>
            <li class="accrow skel"></li>
            <li class="accrow skel"></li>
          </ul>
        </section>
      {:then scope}
        {@const added = scope.added}
        {@const available = scope.available}
        {@const groupedAvailable = groupByChannel(available)}
        <section class="card max-w-2xl">
          <header class="acc-head">
            <div>
              <div class="card-h flush">{m.crm_channels_title()}</div>
              <p class="t-caption mt-1">{m.crm_channels_subtitle()}</p>
            </div>
            <div class="add-wrap">
              <Button variant="outline" size="sm" onclick={() => (addOpen = !addOpen)}>
                <Plus size={14} />
                {m.crm_accounts_add()}
              </Button>
              {#if addOpen}
                <Button
                  variant="ghost"
                  size="sm"
                  class="backdrop"
                  aria-label="close"
                  onclick={() => (addOpen = false)}
                ></Button>
                <div class="add-menu">
                  <div class="add-menu-h">{m.crm_accounts_add_heading()}</div>
                  {#if available.length === 0}
                    <p class="t-caption add-empty">{m.crm_accounts_available_none()}</p>
                  {:else}
                    {#each groupedAvailable as g (g.channel)}
                      <div class="add-group">
                        <div class="add-group-h">
                          <ChannelBrandIcon channel={g.channel} size={13} />
                          {channelLabel(g.channel)}
                        </div>
                        {#each g.items as a (keyOf(a))}
                          <Button
                            variant="ghost"
                            size="sm"
                            class="add-item"
                            disabled={busyKey === keyOf(a)}
                            onclick={() => addAccount(a)}
                          >
                            <span class="add-item-name">{accountName(a)}</span>
                            <span class="t-caption"
                              >{m.crm_channel_contacts({ count: a.contacts })}</span
                            >
                          </Button>
                        {/each}
                      </div>
                    {/each}
                  {/if}
                </div>
              {/if}
            </div>
          </header>

          {#if added.length === 0}
            <p class="t-caption empty-added">{m.crm_accounts_none_added()}</p>
          {:else}
            <ul class="acclist">
              {#each added as a (keyOf(a))}
                <li class="accrow" class:paused={a.paused}>
                  <ChannelBrandIcon channel={a.channel} size={18} />
                  <div class="accinfo">
                    {#if renameKey === keyOf(a)}
                      <div class="rename">
                        <input
                          class="rename-inp"
                          bind:value={renameValue}
                          placeholder={accountName(a)}
                          onkeydown={(e) => {
                            if (e.key === 'Enter') saveRename(a);
                            if (e.key === 'Escape') renameKey = null;
                          }}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          class="icon-btn"
                          aria-label={m.crm_save()}
                          onclick={() => saveRename(a)}><Check size={14} /></Button
                        >
                      </div>
                    {:else}
                      <span class="accname">{accountName(a)}</span>
                      <span class="t-caption">
                        {m.crm_channel_contacts({ count: a.contacts })}{#if a.lastActive}
                          · {m.crm_channel_last_active({ when: relativeTime(a.lastActive) })}{/if}
                      </span>
                    {/if}
                  </div>

                  <span class="state" class:on={!a.paused}>
                    {a.paused ? m.crm_account_status_paused() : m.crm_account_status_active()}
                  </span>

                  <div class="menu-wrap">
                    <Button
                      variant="ghost"
                      size="sm"
                      class="icon-btn"
                      aria-label={m.crm_account_manage()}
                      disabled={busyKey === keyOf(a)}
                      onclick={() => (menuKey = menuKey === keyOf(a) ? null : keyOf(a))}
                    >
                      <Settings2 size={16} />
                    </Button>
                    {#if menuKey === keyOf(a)}
                      <Button
                        variant="ghost"
                        size="sm"
                        class="backdrop"
                        aria-label="close"
                        onclick={() => (menuKey = null)}
                      ></Button>
                      <div class="menu">
                        <Button
                          variant="ghost"
                          size="sm"
                          class="mi"
                          onclick={() => {
                            startRename(a);
                            menuKey = null;
                          }}>{m.crm_account_rename()}</Button
                        >
                        <Button variant="ghost" size="sm" class="mi" onclick={() => togglePause(a)}>
                          {#if a.paused}<Play size={14} /> {m.crm_account_resume()}{:else}<Pause
                              size={14}
                            />
                            {m.crm_account_pause()}{/if}
                        </Button>
                        <div class="msep"></div>
                        <Button
                          variant="ghost"
                          size="sm"
                          class="mi danger"
                          onclick={() => removeAccount(a)}
                          ><Trash2 size={14} /> {m.crm_account_remove()}</Button
                        >
                      </div>
                    {/if}
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/await}
    {:else}
      {#await data.cleanup}
        <div class="flex flex-col gap-6 max-w-5xl">
          <section class="card-skel"></section>
          <section class="card-skel"></section>
        </div>
      {:then cleanup}
        <CrmHygiene fixes={cleanup.fixes} groups={cleanup.groups} blanks={cleanup.blanks} />
      {/await}
    {/if}
  </PageBody>
</PageShell>

<style>
  .tab {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2, 8px);
    padding: var(--space-2, 8px) var(--space-3, 12px);
    font-size: var(--font-size-body, 14px);
    color: var(--color-muted-foreground);
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .tab:hover {
    color: var(--color-foreground);
  }
  .tab.active {
    color: var(--color-accent);
    border-bottom-color: var(--color-accent);
  }
  .card-skel {
    height: 7rem;
    border: 1px dashed var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-card);
    animation: skel-pulse 1.2s ease-in-out infinite;
  }
  .card {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-card);
    padding: var(--space-3, 12px) var(--space-4, 16px);
  }
  .card-h {
    font-size: var(--font-size-caption, 12px);
    font-weight: 600;
    color: var(--color-muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin-bottom: var(--space-3, 12px);
  }
  .card-h.flush {
    margin: 0;
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
  .swatches {
    display: flex;
    gap: var(--space-2, 8px);
  }
  :global(.crm-settings-surface .swatch) {
    width: 22px;
    height: 22px;
    border-radius: var(--radius-full);
    border: 2px solid transparent;
  }
  :global(.crm-settings-surface .swatch.sel) {
    border-color: var(--color-foreground);
  }
  .rule {
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 4px);
    margin-bottom: var(--space-3, 12px);
    padding: var(--space-2, 8px);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-accent) 6%, transparent);
  }
  .rule-row {
    display: flex;
    gap: var(--space-2, 8px);
    flex-wrap: wrap;
  }
  .err {
    color: var(--color-destructive);
    font-size: var(--font-size-body, 14px);
    margin-bottom: var(--space-2, 8px);
  }
  .taglist {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
  }
  .taglist li {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1, 4px);
    padding: var(--space-0-5, 2px) var(--space-2, 8px);
    border-radius: var(--radius-full);
    font-size: var(--font-size-caption, 12px);
    color: var(--c);
    background: color-mix(in srgb, var(--c) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--c) 30%, transparent);
  }
  .auto {
    font-size: var(--font-size-caption, 12px);
    color: var(--color-muted-foreground);
    font-family: var(--font-mono, monospace);
  }
  :global(.crm-settings-surface .del) {
    margin-left: auto;
    opacity: 0.6;
    display: grid;
    place-items: center;
  }
  :global(.crm-settings-surface .del:hover) {
    opacity: 1;
    color: var(--color-destructive);
  }

  /* account manager */
  .acc-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4, 16px);
    margin-bottom: var(--space-3, 12px);
  }
  .add-wrap {
    position: relative;
    flex-shrink: 0;
  }
  .empty-added {
    padding: var(--space-2, 8px) 0;
  }
  .acclist {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
  }
  .accrow {
    display: flex;
    align-items: center;
    gap: var(--space-3, 12px);
    padding: var(--space-2, 8px) var(--space-3, 12px);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    background: var(--color-bg3);
  }
  .accrow.paused {
    opacity: 0.62;
  }
  .accrow.skel {
    height: 2.6rem;
    border-style: dashed;
    animation: skel-pulse 1.2s ease-in-out infinite;
  }
  @keyframes skel-pulse {
    0%,
    100% {
      opacity: 0.35;
    }
    50% {
      opacity: 0.7;
    }
  }
  .accinfo {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5, 2px);
    min-width: 0;
    flex: 1;
  }
  .accname {
    font-size: var(--font-size-body, 14px);
    font-weight: 600;
  }
  .rename {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
  }
  .rename-inp {
    height: 1.8rem;
    flex: 1;
    max-width: 16rem;
    padding: 0 var(--space-2);
    font-size: var(--font-size-body, 14px);
    border-radius: var(--radius-md);
    background: var(--color-bg);
    border: 1px solid var(--hairline);
  }
  .state {
    font-size: var(--font-size-caption, 12px);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--color-muted-foreground);
  }
  .state.on {
    color: var(--color-success, var(--color-emerald));
  }
  :global(.crm-settings-surface .icon-btn) {
    display: grid;
    place-items: center;
    width: 1.9rem;
    height: 1.9rem;
    border-radius: var(--radius-md);
    color: var(--color-muted-foreground);
    flex-shrink: 0;
  }
  :global(.crm-settings-surface .icon-btn:hover) {
    background: color-mix(in srgb, var(--color-foreground) 6%, transparent);
    color: var(--color-foreground);
  }
  :global(.crm-settings-surface .icon-btn:disabled) {
    opacity: 0.5;
  }

  /* dropdowns (add picker + per-account config menu) */
  .menu-wrap {
    position: relative;
    display: inline-flex;
  }
  :global(.crm-settings-surface .backdrop) {
    position: fixed;
    inset: 0;
    z-index: var(--layer-modal);
    background: transparent;
  }
  .menu,
  .add-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: var(--layer-popover, 41);
    min-width: 12rem;
    background: var(--color-card);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-overlay);
    padding: var(--space-1, 4px);
  }
  .add-menu {
    width: 17rem;
    max-height: 20rem;
    overflow: auto;
  }
  .add-menu-h,
  .add-group-h {
    font-size: var(--font-size-caption, 12px);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--color-muted-foreground);
    padding: var(--space-1, 4px) var(--space-2, 8px);
  }
  .add-group-h {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
  }
  .add-empty {
    padding: var(--space-2, 8px);
  }
  :global(.crm-settings-surface .add-item) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2, 8px);
    width: 100%;
    padding: var(--space-2, 8px) var(--space-2, 8px);
    border-radius: var(--radius-sm, var(--radius-md);
    text-align: left;
  }
  :global(.crm-settings-surface .add-item:hover) {
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  }
  :global(.crm-settings-surface .add-item:disabled) {
    opacity: 0.5;
  }
  .add-item-name {
    font-size: var(--font-size-body, 14px);
    font-weight: 500;
  }
  :global(.crm-settings-surface .mi) {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    width: 100%;
    padding: var(--space-2, 8px) var(--space-2, 8px);
    border-radius: var(--radius-sm, var(--radius-md);
    font-size: var(--font-size-body, 14px);
    text-align: left;
    color: var(--color-foreground);
  }
  :global(.crm-settings-surface .mi:hover) {
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  }
  :global(.crm-settings-surface .mi.danger) {
    color: var(--color-destructive);
  }
  :global(.crm-settings-surface .mi.danger:hover) {
    background: color-mix(in srgb, var(--color-destructive) 12%, transparent);
  }
  .msep {
    height: 1px;
    background: var(--hairline);
    margin: var(--space-1, 4px) 0;
  }

  /* AI tag — criteria editor + list row */
  .ta {
    min-height: 4.5rem;
    padding: var(--space-2, 8px) var(--space-2, 8px);
    line-height: 1.4;
    resize: vertical;
    font-family: inherit;
  }
  .ai-rule {
    gap: var(--space-2, 8px);
  }
  .ai-head {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2, 8px);
    color: var(--color-accent);
  }
  .ai-hint {
    font-size: var(--font-size-caption, 12px);
    color: var(--color-muted-foreground);
  }
  .taglist li.ai-row {
    flex-wrap: wrap;
  }
  .ai-desc {
    font-size: var(--font-size-caption, 12px);
    color: var(--color-muted-foreground);
    max-width: 18rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.crm-settings-surface .find) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1, 4px);
    font-size: var(--font-size-caption, 12px);
    font-weight: 500;
    color: var(--color-accent);
    padding: var(--space-1, 4px) var(--space-2, 8px);
    border-radius: var(--radius-md);
    border: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
    background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  }
  :global(.crm-settings-surface .find:hover) {
    background: color-mix(in srgb, var(--color-accent) 16%, transparent);
  }
  :global(.crm-settings-surface .find:disabled) {
    opacity: 0.6;
  }
  .ai-result {
    font-size: var(--font-size-caption, 12px);
    color: var(--color-success, var(--color-emerald));
  }
</style>
