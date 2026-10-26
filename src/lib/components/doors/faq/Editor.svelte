<script lang="ts">
  import { ArrowDown, ArrowUp, Plus, Sparkles, Trash2 } from 'lucide-svelte';
  import { Textarea } from '@minion-stack/ui';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import { Button, Input, Toggle, iconSizes } from '$lib/components/ui';
  import { FormField } from '$lib/components/ui/foundations';
  import { toastSuccess } from '$lib/state/ui/toast.svelte';
  import type { DoorEditorProps } from '$lib/doors/types';
  import { FAQ_A_MAX, FAQ_MAX_ENTRIES, FAQ_Q_MAX, type FaqEntry } from '$lib/doors/kinds/faq';

  let { config, onchange, canManage }: DoorEditorProps = $props();

  // Controlled: read leniently (a half-typed draft may not pass the schema yet), emit whole configs.
  const cfg = $derived.by(() => {
    const raw = (config && typeof config === 'object' ? config : {}) as {
      entries?: unknown;
      whatsappNumber?: unknown;
    };
    return {
      entries: (Array.isArray(raw.entries) ? raw.entries : []) as FaqEntry[],
      whatsappNumber: typeof raw.whatsappNumber === 'string' ? raw.whatsappNumber : undefined,
    };
  });

  function emit(entries: FaqEntry[], whatsappNumber = cfg.whatsappNumber) {
    onchange(whatsappNumber ? { entries, whatsappNumber } : { entries });
  }
  function update(i: number, patch: Partial<FaqEntry>) {
    emit(cfg.entries.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  }
  function move(i: number, by: -1 | 1) {
    const next = [...cfg.entries];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    emit(next);
  }
  const full = $derived(cfg.entries.length >= FAQ_MAX_ENTRIES);

  function add() {
    if (full) return;
    emit([...cfg.entries, { id: crypto.randomUUID(), q: '', a: '', status: 'draft' }]);
  }

  let suggesting = $state(false);
  let notice = $state<{ tone: 'error' | 'info'; text: string } | null>(null);

  async function suggest() {
    if (!canManage || suggesting) return;
    suggesting = true;
    notice = null;
    try {
      const res = await fetch(
        `/api/crm/doors/${encodeURIComponent(page.params.id ?? '')}/faq-draft`,
        { method: 'POST' },
      );
      if (!res.ok) {
        notice = {
          tone: 'error',
          text:
            res.status === 403
              ? m.doors_no_permission()
              : res.status === 503
                ? m.doors_faq_ai_not_configured()
                : res.status === 429
                  ? m.doors_faq_rate_limited()
                  : m.doors_faq_suggest_error(),
        };
        return;
      }
      const { drafts } = (await res.json()) as { drafts: Array<{ q: string; a: string }> };
      if (drafts.length === 0) {
        notice = { tone: 'info', text: m.doors_faq_suggest_none() };
        return;
      }
      const added: FaqEntry[] = drafts
        .slice(0, FAQ_MAX_ENTRIES - cfg.entries.length)
        .map((d) => ({ id: crypto.randomUUID(), q: d.q, a: d.a, status: 'draft' }));
      if (added.length === 0) {
        notice = { tone: 'info', text: m.doors_faq_full({ max: FAQ_MAX_ENTRIES }) };
        return;
      }
      emit([...cfg.entries, ...added]);
      toastSuccess(m.doors_faq_suggested({ count: added.length }));
    } catch {
      notice = { tone: 'error', text: m.doors_faq_suggest_error() };
    } finally {
      suggesting = false;
    }
  }
</script>

<div class="faq-editor">
  <div class="head">
    <h2 class="t-label title">{m.doors_faq_questions()}</h2>
    {#if canManage}
      <Button size="sm" variant="secondary" onclick={suggest} loading={suggesting}>
        {#snippet icon()}<Sparkles size={iconSizes.sm} />{/snippet}
        {m.doors_faq_suggest()}
      </Button>
    {/if}
  </div>
  <p class="t-caption muted">{m.doors_faq_suggest_hint()} {m.doors_faq_approved_hint()}</p>
  {#if notice}
    <p
      class={['notice', { error: notice.tone === 'error' }]}
      role={notice.tone === 'error' ? 'alert' : 'status'}
    >
      {notice.text}
    </p>
  {/if}

  {#if cfg.entries.length === 0}
    <p class="t-body muted">{m.doors_faq_empty()}</p>
  {/if}

  {#each cfg.entries as entry, i (entry.id)}
    <section class="entry" aria-label={entry.q || m.doors_faq_question()}>
      <div class="entry-bar">
        <Toggle
          checked={entry.status === 'approved'}
          disabled={!canManage || (entry.status !== 'approved' && !entry.a.trim())}
          label={m.doors_faq_approved()}
          description={!entry.a.trim() ? m.doors_faq_needs_answer() : undefined}
          onchange={(checked) => update(i, { status: checked ? 'approved' : 'draft' })}
        />
        {#if canManage}
          <div class="entry-actions">
            <Button
              variant="ghost"
              shape="icon"
              size="xs"
              disabled={i === 0}
              onclick={() => move(i, -1)}
              aria-label={m.doors_faq_move_up()}
            >
              <ArrowUp size={iconSizes.sm} />
            </Button>
            <Button
              variant="ghost"
              shape="icon"
              size="xs"
              disabled={i === cfg.entries.length - 1}
              onclick={() => move(i, 1)}
              aria-label={m.doors_faq_move_down()}
            >
              <ArrowDown size={iconSizes.sm} />
            </Button>
            <Button
              variant="ghost"
              shape="icon"
              size="xs"
              onclick={() => emit(cfg.entries.filter((_, j) => j !== i))}
              aria-label={m.doors_faq_remove()}
            >
              <Trash2 size={iconSizes.sm} />
            </Button>
          </div>
        {/if}
      </div>
      <FormField label={m.doors_faq_question()} required disabled={!canManage}>
        {#snippet children(p)}<Input
            {...p}
            value={entry.q}
            maxlength={FAQ_Q_MAX}
            oninput={(e: Event) => update(i, { q: (e.currentTarget as HTMLInputElement).value })}
          />{/snippet}
      </FormField>
      <Textarea
        id={`faq-answer-${entry.id}`}
        label={m.doors_faq_answer()}
        rows={3}
        maxlength={FAQ_A_MAX}
        value={entry.a}
        disabled={!canManage}
        oninput={(e: Event) => update(i, { a: (e.currentTarget as HTMLTextAreaElement).value })}
      />
    </section>
  {/each}

  {#if canManage}
    <div class="foot">
      <Button size="sm" variant="ghost" onclick={add} disabled={full}>
        {#snippet icon()}<Plus size={iconSizes.sm} />{/snippet}
        {m.doors_faq_add()}
      </Button>
      {#if full}
        <span class="t-caption muted">{m.doors_faq_full({ max: FAQ_MAX_ENTRIES })}</span>
      {/if}
    </div>
  {/if}

  <FormField
    label={m.doors_faq_whatsapp()}
    helper={m.doors_faq_whatsapp_hint()}
    disabled={!canManage}
  >
    {#snippet children(p)}<Input
        {...p}
        type="tel"
        value={cfg.whatsappNumber ?? ''}
        maxlength={16}
        oninput={(e: Event) =>
          emit(cfg.entries, (e.currentTarget as HTMLInputElement).value.trim() || undefined)}
      />{/snippet}
  </FormField>
</div>

<style>
  .faq-editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .head,
  .entry-bar,
  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .title {
    margin: 0;
    color: var(--color-text-primary);
  }
  .entry {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
  }
  .entry-actions {
    display: inline-flex;
    gap: var(--space-1);
  }
  .foot {
    justify-content: flex-start;
  }
  .muted {
    margin: 0;
    color: var(--color-text-secondary);
  }
  .notice {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-info-border);
    border-radius: var(--radius-md);
    color: var(--color-info-fg);
    background: var(--color-info-surface);
    font-size: var(--font-size-caption);
  }
  .notice.error {
    border-color: var(--color-danger-border);
    color: var(--color-danger-fg);
    background: var(--color-danger-surface);
  }
</style>
