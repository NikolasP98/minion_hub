<script lang="ts">
  import type { PageData } from './$types';
  import { invalidate } from '$app/navigation';
  import { Settings } from 'lucide-svelte';
  import { PageHeader, Card, Button, Input } from '$lib/components/ui';
  import { Textarea } from '@minion-stack/ui';
  import PageBody from '$lib/components/ui/foundations/PageBody.svelte';
  import PageShell from '$lib/components/ui/foundations/PageShell.svelte';
  import * as m from '$lib/paraglide/messages';
  import type { FanOutResult } from '$server/services/brain-agents.service';

  let { data }: { data: PageData } = $props();

  // svelte-ignore state_referenced_locally -- seeding the editable draft once
  // from the loaded template; converting to $derived would wipe in-progress edits.
  let namePrefix = $state(data.template.namePrefix);
  // svelte-ignore state_referenced_locally
  let emoji = $state(data.template.emoji ?? '');
  // svelte-ignore state_referenced_locally
  let model = $state(data.template.model ?? '');
  // svelte-ignore state_referenced_locally
  let instructions = $state(data.template.instructions);

  let saving = $state(false);
  let error = $state('');
  let fanOut = $state<FanOutResult[] | null>(null);

  const canSubmit = $derived(namePrefix.trim().length > 0);

  async function save() {
    if (!canSubmit || saving) return;
    saving = true;
    error = '';
    fanOut = null;
    try {
      const res = await fetch('/api/brains/template', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          namePrefix: namePrefix.trim(),
          emoji: emoji.trim() || null,
          model: model.trim() || null,
          instructions,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        error = (body as { message?: string }).message ?? m.brains_template_save_error();
        return;
      }
      const body = (await res.json()) as { fanOut: FanOutResult[] };
      fanOut = body.fanOut;
      await invalidate('brains:template');
    } catch (e) {
      error = e instanceof Error ? e.message : m.brains_template_save_error();
    } finally {
      saving = false;
    }
  }

  const fanOutFailures = $derived(fanOut?.filter((r) => !r.ok) ?? []);
</script>

<svelte:head><title>{m.brains_nav_template()} · {m.nav_brains()}</title></svelte:head>

<PageShell archetype="form" scroll="none">
  <PageHeader title={m.brains_template_page_title()} subtitle={m.brains_template_page_subtitle()}>
    {#snippet leading()}
      <Settings size={16} class="text-accent shrink-0" />
    {/snippet}
  </PageHeader>

  <PageBody width="reading" scroll="region">
    <Card padding="lg">
      <div class="template-form">
        <p class="template-intro">
          {m.brains_template_page_desc()}
        </p>

        <Input
          label={m.brains_template_field_name_prefix()}
          bind:value={namePrefix}
          helper={m.brains_template_field_name_prefix_help()}
        />

        <Input
          label={m.brains_template_field_emoji()}
          bind:value={emoji}
          placeholder="🧠"
          helper={m.brains_template_field_emoji_help()}
        />

        <Input
          label={m.brains_template_field_model()}
          bind:value={model}
          placeholder="claude-sonnet-4-5"
          helper={m.brains_template_field_model_help()}
        />

        <Textarea
          id="brain-template-instructions"
          label={m.brains_template_field_instructions()}
          bind:value={instructions}
          rows={10}
          size="lg"
        />
        <span class="template-help">
          {m.brains_template_field_instructions_help()}
          <code>{'{{brain_name}}'}</code>,
          <code>{'{{brain_description}}'}</code>
        </span>

        {#if error}
          <p class="form-error" role="alert">{error}</p>
        {/if}

        {#if fanOut}
          <div class="fanout-result" role="status">
            <p>{m.brains_template_fanout_summary({ count: fanOut.length })}</p>
            {#if fanOutFailures.length > 0}
              <p class="fanout-error">
                {m.brains_template_fanout_failures({ count: fanOutFailures.length })}
              </p>
              <ul class="fanout-list">
                {#each fanOutFailures as f (f.agentId)}
                  <li>{f.agentId}: {f.error}</li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}

        <div class="form-actions">
          <Button variant="primary" disabled={!canSubmit} loading={saving} onclick={save}>
            {m.brains_template_save()}
          </Button>
        </div>
      </div>
    </Card>
  </PageBody>
</PageShell>

<style>
  .template-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-section);
  }

  .template-intro,
  .fanout-result {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-info-border);
    border-radius: var(--radius-lg);
    color: var(--color-text-primary);
    background: var(--color-info-surface);
    font-size: var(--font-size-body);
    line-height: var(--line-height-body);
  }

  .template-help {
    margin-top: calc(-1 * var(--space-section));
    color: var(--color-text-tertiary);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
  }

  .template-help code {
    padding: var(--space-0-5) var(--space-1);
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    background: var(--color-surface-1);
    font-family: var(--font-family-mono);
  }

  .form-error,
  .fanout-error,
  .fanout-list {
    color: var(--color-danger-fg);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
  }

  .fanout-error,
  .fanout-list {
    margin-top: var(--space-1);
  }

  .fanout-list {
    padding-left: var(--space-6);
    list-style: disc;
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
