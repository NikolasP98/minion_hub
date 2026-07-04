<script lang="ts">
  import type { PageData } from './$types';
  import { invalidate } from '$app/navigation';
  import { Settings } from 'lucide-svelte';
  import { PageHeader, Card, Button, Input } from '$lib/components/ui';
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

<div class="flex h-full flex-col overflow-hidden">
  <PageHeader title={m.brains_template_page_title()} subtitle={m.brains_template_page_subtitle()}>
    {#snippet leading()}
      <Settings size={16} class="text-accent shrink-0" />
    {/snippet}
  </PageHeader>

  <div class="flex-1 min-h-0 overflow-y-auto p-6">
    <Card padding="lg" class="max-w-2xl">
      <div class="flex flex-col gap-5">
        <p class="rounded-lg border border-[color-mix(in_srgb,var(--color-accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] px-3 py-2 text-sm text-foreground/90">
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

        <div class="flex flex-col gap-1.5">
          <label class="t-label normal-case tracking-normal text-foreground/80" for="brain-template-instructions">
            {m.brains_template_field_instructions()}
          </label>
          <textarea
            id="brain-template-instructions"
            bind:value={instructions}
            rows={10}
            class="focus-ring-none w-full resize-y rounded-[var(--radius-md)] border border-[var(--hairline)] bg-bg2 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-colors duration-[150ms] focus:border-accent/60"
          ></textarea>
          <span class="t-caption">
            {m.brains_template_field_instructions_help()}
            <code class="rounded bg-white/[0.06] px-1 py-0.5 text-foreground/80">{'{{brain_name}}'}</code>,
            <code class="rounded bg-white/[0.06] px-1 py-0.5 text-foreground/80">{'{{brain_description}}'}</code>
          </span>
        </div>

        {#if error}
          <p class="text-sm text-destructive">{error}</p>
        {/if}

        {#if fanOut}
          <div class="rounded-lg border border-[var(--hairline)] bg-white/[0.02] px-3 py-2 text-sm">
            <p class="text-foreground/90">{m.brains_template_fanout_summary({ count: fanOut.length })}</p>
            {#if fanOutFailures.length > 0}
              <p class="mt-1 text-destructive">{m.brains_template_fanout_failures({ count: fanOutFailures.length })}</p>
              <ul class="mt-1 list-disc pl-5 text-xs text-destructive/90">
                {#each fanOutFailures as f (f.agentId)}
                  <li>{f.agentId}: {f.error}</li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}

        <div class="flex justify-end">
          <Button variant="primary" disabled={!canSubmit} loading={saving} onclick={save}>
            {m.brains_template_save()}
          </Button>
        </div>
      </div>
    </Card>
  </div>
</div>
